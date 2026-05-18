require('dotenv').config();
const express   = require('express');
const path      = require('path');
const cors      = require('cors');
const fs        = require('fs');
const http      = require('http');
const https     = require('https');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Groq = require('groq-sdk');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET     = process.env.JWT_SECRET     || 'supportos_dev_secret_change_in_prod';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'supportos2026';

// ─── JSON FILE DATABASE ───────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function readDB(name) {
  const file = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function writeDB(name, data) {
  fs.writeFileSync(path.join(DATA_DIR, name + '.json'), JSON.stringify(data, null, 2));
}

function now() { return new Date().toISOString(); }

// Seed admin user
const admins = readDB('admins');
if (!admins.find(a => a.username === 'admin')) {
  admins.push({ id: uuidv4(), username: 'admin', password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 10), created_at: now() });
  writeDB('admins', admins);
}

// ─── RATE LIMITER (no extra deps) ────────────────────────────────────────────
const rateLimits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now_ = Date.now();
    const entry = rateLimits.get(key) || { count: 0, reset: now_ + windowMs };
    if (now_ > entry.reset) { entry.count = 0; entry.reset = now_ + windowMs; }
    entry.count++;
    rateLimits.set(key, entry);
    if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    next();
  };
}
// Clean up rate limit map every 10 min
setInterval(() => { const now_ = Date.now(); rateLimits.forEach((v, k) => { if (now_ > v.reset) rateLimits.delete(k); }); }, 600000);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);

const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
};

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

app.post('/api/audit',   rateLimit(10, 60000), (req, res) => {
  const { name, email, company, phone, helpdesk, weekly_tickets, main_pain } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Name and email are required.' });
  const record = { id: uuidv4(), name, email, company: company||'', phone: phone||'', helpdesk: helpdesk||'', weekly_tickets: weekly_tickets||'', main_pain: main_pain||'', status: 'pending', notes: '', created_at: now() };
  const audits = readDB('audits');
  audits.unshift(record);
  writeDB('audits', audits);
  dispatchWebhook('audit.created', record);
  res.json({ success: true, id: record.id, message: 'Audit request received. We will contact you within 24 hours.' });
});

app.post('/api/contact', rateLimit(10, 60000), (req, res) => {
  const { name, email, company, message } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const record = { id: uuidv4(), name: name||'', email, company: company||'', message: message||'', source: 'landing', status: 'new', notes: '', created_at: now() };
  const leads = readDB('leads');
  leads.unshift(record);
  writeDB('leads', leads);
  dispatchWebhook('lead.created', record);
  res.json({ success: true, id: record.id, message: 'Message received. We will be in touch shortly.' });
});

// ─── AI DEMO ──────────────────────────────────────────────────────────────────

const DEMO_SYSTEM = `You are the SupportOS AI engine — a live demonstration of an intelligent customer support triage system. When a user submits a support message, you process it and respond ONLY with a valid JSON object in this exact structure:

{
  "triage": {
    "category": "one of: billing, technical, shipping, returns, account, general",
    "priority": "one of: urgent, high, normal, low",
    "sentiment": "one of: frustrated, angry, neutral, positive",
    "confidence": "a percentage string like 94%"
  },
  "routing": {
    "team": "the specific team name to route to",
    "sla": "response time SLA e.g. 2 hours",
    "reason": "brief reason for routing decision"
  },
  "suggested_reply": "A complete, warm, professional reply to the customer. 2-3 sentences. Do not use placeholders.",
  "crm_note": "A concise internal CRM note for the next agent. 1-2 sentences.",
  "auto_close": false,
  "auto_close_reason": "if auto_close is true, explain why, otherwise empty string"
}

Be realistic. Show intelligent triage. Only respond with the JSON object — no other text.`;

app.post('/api/demo/chat', rateLimit(30, 60000), async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  const sid = sessionId || uuidv4();
  const sessions = readDB('sessions');
  let session = sessions.find(s => s.id === sid);
  if (!session) {
    session = { id: sid, messages: [], created_at: now(), updated_at: now() };
    sessions.unshift(session);
  }
  session.messages.push({ role: 'user', content: message });
  session.updated_at = now();

  try {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.trim() === '') {
      throw new Error('No API key');
    }
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [
        { role: 'system', content: DEMO_SYSTEM },
        ...session.messages.map(m => ({ role: m.role, content: m.content }))
      ]
    });
    const rawText = response.choices[0].message.content;
    const match = rawText.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : buildMock(message);
    session.messages.push({ role: 'assistant', content: rawText });
    writeDB('sessions', sessions);
    res.json({ success: true, sessionId: sid, data, mock: false });
  } catch (err) {
    const data = buildMock(message);
    session.messages.push({ role: 'assistant', content: JSON.stringify(data) });
    writeDB('sessions', sessions);
    res.json({ success: true, sessionId: sid, data, mock: true });
  }
});

function buildMock(message) {
  const m = message.toLowerCase();
  const isBilling   = /charge|bill|invoice|refund|payment|price|cost|subscription/.test(m);
  const isShipping  = /ship|deliver|order|track|package|arrival|late/.test(m);
  const isTech      = /error|bug|crash|login|password|broken|issue|not working|fail|reset/.test(m);
  const isReturn    = /return|exchange|damaged|wrong item|cancel/.test(m);
  const isUrgent    = /urgent|asap|immediately|broken|down|emergency|critical/.test(m);
  const isFrustrated = /frustrated|angry|terrible|awful|worst|unacceptable/.test(m);

  const cat = isBilling ? 'billing' : isShipping ? 'shipping' : isTech ? 'technical' : isReturn ? 'returns' : 'general';

  const teams = { billing:'Billing & Accounts Team', shipping:'Fulfillment & Logistics Team', technical:'Technical Support Team', returns:'Returns & Exchange Team', general:'General Support Team' };
  const replies = {
    billing:   "Thank you for reaching out about your billing concern. I've pulled up your account and I'm reviewing the details right now. I'll send you a full breakdown and resolution within 2 hours — your satisfaction is our priority.",
    shipping:  "I completely understand how important timely delivery is. I've located your order and I'm getting the latest status from our fulfillment team right now. You'll receive a full tracking update within the hour.",
    technical: "I'm sorry you're experiencing this issue — let's resolve it quickly. I've flagged your account for immediate review by our technical team. Could you confirm which device and browser you're using so we can replicate and fix this faster?",
    returns:   "I'm sorry to hear about this. I've initiated a return request on your behalf right now. Our returns team will send you a prepaid shipping label and full instructions within 24 hours.",
    general:   "Thank you for reaching out! I've reviewed your message and assigned your case to the right specialist who will follow up with you shortly. Is there anything else I can clarify in the meantime?"
  };
  const crmNotes = {
    billing:   `Customer contacted re: billing issue. Auto-categorized → Billing & Accounts. Priority: ${isUrgent ? 'urgent' : 'normal'}.`,
    shipping:  'Customer inquiring about delivery. Auto-routed → Fulfillment. Order lookup initiated.',
    technical: `Technical issue reported. Auto-routed → Tech Support. ${isUrgent ? 'URGENT — escalate immediately.' : 'Normal queue.'}`,
    returns:   'Return/exchange request initiated. Auto-routed → Returns Team. Label to be issued within 24h.',
    general:   'General inquiry. Auto-routed → General Support. No escalation signals.'
  };

  return {
    triage: {
      category:   cat,
      priority:   isUrgent ? 'urgent' : isFrustrated ? 'high' : 'normal',
      sentiment:  isFrustrated ? 'frustrated' : isUrgent ? 'angry' : 'neutral',
      confidence: `${Math.floor(88 + Math.random() * 11)}%`
    },
    routing: {
      team:   teams[cat],
      sla:    isUrgent ? '30 minutes' : cat === 'technical' ? '2 hours' : '4 hours',
      reason: `Message contains ${cat}-related keywords. Routing to specialized team for optimal resolution.`
    },
    suggested_reply:   replies[cat],
    crm_note:          crmNotes[cat],
    auto_close:        false,
    auto_close_reason: ''
  };
}

// ─── ADMIN API ────────────────────────────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = readDB('admins').find(a => a.username === username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password.' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token, username: user.username });
});

app.get('/api/admin/stats', auth, (req, res) => {
  const leads   = readDB('leads');
  const audits  = readDB('audits');
  const sessions = readDB('sessions');
  res.json({
    totalLeads:    leads.length,
    newLeads:      leads.filter(r => r.status === 'new').length,
    totalAudits:   audits.length,
    pendingAudits: audits.filter(r => r.status === 'pending').length,
    demoSessions:  sessions.length,
    recentLeads:   leads.slice(0, 6),
    recentAudits:  audits.slice(0, 6)
  });
});

app.get('/api/admin/leads',  auth, (_req, res) => res.json(readDB('leads')));
app.get('/api/admin/audits', auth, (_req, res) => res.json(readDB('audits')));

app.patch('/api/admin/leads/:id', auth, (req, res) => {
  const rows = readDB('leads');
  const idx  = rows.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  rows[idx] = { ...rows[idx], status: req.body.status, notes: req.body.notes || '' };
  writeDB('leads', rows);
  res.json({ success: true });
});

app.patch('/api/admin/audits/:id', auth, (req, res) => {
  const rows = readDB('audits');
  const idx  = rows.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  rows[idx] = { ...rows[idx], status: req.body.status, notes: req.body.notes || '' };
  writeDB('audits', rows);
  res.json({ success: true });
});

app.delete('/api/admin/leads/:id',  auth, (req, res) => {
  writeDB('leads', readDB('leads').filter(r => r.id !== req.params.id));
  res.json({ success: true });
});

app.delete('/api/admin/audits/:id', auth, (req, res) => {
  writeDB('audits', readDB('audits').filter(r => r.id !== req.params.id));
  res.json({ success: true });
});

app.get('/api/admin/demo-sessions', auth, (_req, res) => {
  res.json(readDB('sessions').map(s => ({ id: s.id, messages: s.messages.length, created_at: s.created_at, updated_at: s.updated_at })));
});

app.get('/api/admin/export/leads', auth, (_req, res) => {
  const rows = readDB('leads');
  const header = 'id,name,email,company,source,status,notes,created_at';
  const csv = [header, ...rows.map(r =>
    [r.id, r.name, r.email, r.company, r.source, r.status, `"${(r.notes||'').replace(/"/g,'""')}"`, r.created_at].join(',')
  )].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="supportos-leads.csv"');
  res.send(csv);
});

app.get('/api/admin/export/audits', auth, (_req, res) => {
  const rows = readDB('audits');
  const header = 'id,name,email,company,phone,helpdesk,weekly_tickets,main_pain,status,notes,created_at';
  const csv = [header, ...rows.map(r =>
    [r.id, r.name, r.email, r.company, r.phone, r.helpdesk, r.weekly_tickets,
     `"${(r.main_pain||'').replace(/"/g,'""')}"`, r.status, `"${(r.notes||'').replace(/"/g,'""')}"`, r.created_at].join(',')
  )].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="supportos-audits.csv"');
  res.send(csv);
});

// ─── SETTINGS & WEBHOOKS ─────────────────────────────────────────────────────
function getSettings() {
  const rows = readDB('settings');
  return rows[0] || { webhook_url: '', webhook_enabled: false, webhook_secret: '' };
}
function saveSettings(data) { writeDB('settings', [data]); }

function dispatchWebhook(event, data) {
  const cfg = getSettings();
  if (!cfg.webhook_enabled || !cfg.webhook_url) return;
  try {
    const payload = JSON.stringify({ event, timestamp: now(), data });
    const url = new URL(cfg.webhook_url);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-SupportOS-Event': event,
        ...(cfg.webhook_secret ? { 'X-SupportOS-Signature': cfg.webhook_secret } : {})
      }
    };
    const req = (url.protocol === 'https:' ? https : http).request(options, r => {
      logWebhook(event, cfg.webhook_url, r.statusCode, '');
    });
    req.on('error', err => logWebhook(event, cfg.webhook_url, 0, err.message));
    req.write(payload);
    req.end();
  } catch (err) {
    logWebhook(event, cfg.webhook_url, 0, err.message);
  }
}

function logWebhook(event, url, status, error) {
  const logs = readDB('webhook_logs');
  logs.unshift({ id: uuidv4(), event, url, status, error, created_at: now() });
  writeDB('webhook_logs', logs.slice(0, 100));
}

app.get('/api/admin/settings', auth, (_req, res) => res.json(getSettings()));
app.put('/api/admin/settings', auth, (req, res) => {
  const current = getSettings();
  saveSettings({ ...current, ...req.body });
  res.json({ success: true });
});
app.get('/api/admin/webhook-logs', auth, (_req, res) => res.json(readDB('webhook_logs')));
app.post('/api/admin/webhook-test', auth, (req, res) => {
  dispatchWebhook('test.ping', { message: 'SupportOS webhook test', timestamp: now() });
  res.json({ success: true, message: 'Test event dispatched.' });
});

// ─── API KEY SYSTEM ───────────────────────────────────────────────────────────
function generateKey() { return 'sos_' + uuidv4().replace(/-/g, ''); }

const apiKeyAuth = (req, res, next) => {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'API key required. Set X-Api-Key header.' });
  const keys = readDB('api_keys');
  const found = keys.find(k => k.key === key && k.active);
  if (!found) return res.status(401).json({ error: 'Invalid or inactive API key.' });
  found.last_used = now(); found.calls = (found.calls || 0) + 1;
  writeDB('api_keys', keys);
  req.apiKey = found;
  next();
};

app.get('/api/admin/keys', auth, (_req, res) => {
  res.json(readDB('api_keys').map(k => ({ ...k, key: k.key.slice(0, 12) + '••••••••••••' })));
});
app.post('/api/admin/keys', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const record = { id: uuidv4(), name, key: generateKey(), active: true, calls: 0, last_used: null, created_at: now() };
  const keys = readDB('api_keys');
  keys.push(record);
  writeDB('api_keys', keys);
  res.json({ success: true, ...record }); // return full key ONCE on creation
});
app.delete('/api/admin/keys/:id', auth, (req, res) => {
  writeDB('api_keys', readDB('api_keys').filter(k => k.id !== req.params.id));
  res.json({ success: true });
});
app.patch('/api/admin/keys/:id/toggle', auth, (req, res) => {
  const keys = readDB('api_keys');
  const k = keys.find(k => k.id === req.params.id);
  if (!k) return res.status(404).json({ error: 'Not found' });
  k.active = !k.active;
  writeDB('api_keys', keys);
  res.json({ success: true, active: k.active });
});

// ─── PUBLIC TRIAGE API (API key protected) ────────────────────────────────────
app.post('/api/triage', rateLimit(60, 60000), apiKeyAuth, async (req, res) => {
  const { message, session_id, metadata } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required.' });
  const sid = session_id || uuidv4();
  try {
    if (!process.env.GROQ_API_KEY || !process.env.GROQ_API_KEY.trim()) throw new Error('no key');
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      temperature: 0.3,
      messages: [{ role: 'system', content: DEMO_SYSTEM }, { role: 'user', content: message }]
    });
    const rawText = response.choices[0].message.content;
    const match = rawText.match(/\{[\s\S]*\}/);
    const data = match ? JSON.parse(match[0]) : buildMock(message);
    res.json({ success: true, session_id: sid, data, mock: false, metadata: metadata || null });
  } catch {
    res.json({ success: true, session_id: sid, data: buildMock(message), mock: true, metadata: metadata || null });
  }
});

// ─── PAGE ALIASES ─────────────────────────────────────────────────────────────
app.get('/demo',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'demo.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/docs',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'docs.html')));

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │   SupportOS running on port ${PORT}           │`);
  console.log(`  ├──────────────────────────────────────────┤`);
  console.log(`  │  Landing  →  http://localhost:${PORT}          │`);
  console.log(`  │  Demo     →  http://localhost:${PORT}/demo     │`);
  console.log(`  │  Admin    →  http://localhost:${PORT}/admin    │`);
  console.log(`  ├──────────────────────────────────────────┤`);
  console.log(`  │  Login: admin / ${ADMIN_PASSWORD.padEnd(26)} │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
});
