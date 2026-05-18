/**
 * SupportOS Embeddable Chat Widget
 * Embed: <script src="https://your-domain.com/widget.js" data-key="sos_YOUR_KEY"></script>
 */
(function () {
  'use strict';

  const script = document.currentScript;
  const BASE   = script ? new URL(script.src).origin : window.location.origin;
  const CFG = {
    key:      script?.getAttribute('data-key')      || '',
    title:    script?.getAttribute('data-title')    || 'How can we help?',
    subtitle: script?.getAttribute('data-subtitle') || 'AI-powered support — reply in seconds',
    color:    script?.getAttribute('data-color')    || '#00d4aa',
    position: script?.getAttribute('data-position') || 'right',
    agentName:script?.getAttribute('data-agent')    || 'SupportOS AI',
  };

  // ── STYLES ──────────────────────────────────────────────────────────────────
  const css = `
    #sos-widget-btn {
      position: fixed; bottom: 28px; ${CFG.position}: 28px; z-index: 99999;
      width: 58px; height: 58px; border-radius: 50%;
      background: ${CFG.color}; border: none; cursor: pointer;
      box-shadow: 0 6px 28px rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center;
      transition: transform .2s, box-shadow .2s; font-size: 22px;
    }
    #sos-widget-btn:hover { transform: scale(1.08); box-shadow: 0 10px 36px rgba(0,0,0,.35); }
    #sos-widget-btn .sos-close { display: none; font-size: 20px; color: #07090f; font-weight: 700; }
    #sos-widget-btn.open .sos-icon { display: none; }
    #sos-widget-btn.open .sos-close { display: block; }

    #sos-widget-panel {
      position: fixed; bottom: 100px; ${CFG.position}: 28px; z-index: 99998;
      width: 360px; height: 520px;
      background: #0e1120; border: 1px solid #1e2540; border-radius: 20px;
      box-shadow: 0 16px 64px rgba(0,0,0,.5); display: flex; flex-direction: column; overflow: hidden;
      transform: scale(.92) translateY(20px); opacity: 0;
      transition: transform .25s cubic-bezier(.34,1.56,.64,1), opacity .2s;
      pointer-events: none;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    #sos-widget-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }

    .sos-header {
      padding: 18px 20px; display: flex; gap: 12px; align-items: center;
      background: linear-gradient(135deg, rgba(0,212,170,.12), rgba(91,138,255,.08));
      border-bottom: 1px solid #1e2540; flex-shrink: 0;
    }
    .sos-av { width: 38px; height: 38px; border-radius: 50%; background: rgba(0,212,170,.2); display: flex; align-items: center; justify-content: center; font-size: .8rem; font-weight: 700; color: ${CFG.color}; flex-shrink: 0; position: relative; }
    .sos-av::after { content: ''; width: 9px; height: 9px; background: #22c55e; border-radius: 50%; border: 2px solid #0e1120; position: absolute; bottom: 1px; right: 1px; }
    .sos-header-text .sos-title { font-size: .95rem; font-weight: 700; color: #fff; }
    .sos-header-text .sos-sub { font-size: .75rem; color: #7b82a0; margin-top: 1px; }
    .sos-powered { margin-left: auto; font-size: .65rem; color: #7b82a0; text-align: right; line-height: 1.4; }
    .sos-powered a { color: ${CFG.color}; text-decoration: none; }

    .sos-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; scrollbar-color: #1e2540 transparent; }
    .sos-msg { max-width: 85%; display: flex; flex-direction: column; gap: 3px; }
    .sos-msg.user { align-self: flex-end; align-items: flex-end; }
    .sos-msg.agent { align-self: flex-start; align-items: flex-start; }
    .sos-bubble { padding: 10px 13px; border-radius: 14px; font-size: .88rem; line-height: 1.55; }
    .sos-bubble.user { background: ${CFG.color}; color: #07090f; font-weight: 500; border-radius: 14px 14px 4px 14px; }
    .sos-bubble.agent { background: #141828; border: 1px solid #1e2540; color: #e8eaf6; border-radius: 14px 14px 14px 4px; }
    .sos-badge { display: inline-block; padding: 2px 9px; border-radius: 4px; font-size: .68rem; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; margin-top: 5px; }
    .sos-badge.billing    { background: rgba(255,180,0,.12); color: #ffb400; }
    .sos-badge.technical  { background: rgba(91,138,255,.12); color: #5b8aff; }
    .sos-badge.shipping   { background: rgba(0,212,170,.1);  color: #00d4aa; }
    .sos-badge.returns    { background: rgba(255,107,107,.1); color: #ff6b6b; }
    .sos-badge.account    { background: rgba(167,139,250,.1); color: #a78bfa; }
    .sos-badge.general    { background: rgba(123,130,160,.1); color: #7b82a0; }
    .sos-time { font-size: .68rem; color: #7b82a0; }

    .sos-typing { display: flex; gap: 4px; padding: 10px 13px; background: #141828; border: 1px solid #1e2540; border-radius: 14px 14px 14px 4px; width: fit-content; }
    .sos-typing span { width: 6px; height: 6px; background: #7b82a0; border-radius: 50%; animation: sos-bounce .8s infinite; }
    .sos-typing span:nth-child(2) { animation-delay: .15s; }
    .sos-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes sos-bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-7px)} }

    .sos-input-area { padding: 12px 14px; border-top: 1px solid #1e2540; display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0; }
    .sos-input { flex: 1; background: #141828; border: 1px solid #1e2540; border-radius: 10px; color: #e8eaf6; font-size: .88rem; padding: 9px 13px; outline: none; resize: none; max-height: 80px; font-family: inherit; line-height: 1.5; transition: border-color .2s; }
    .sos-input:focus { border-color: ${CFG.color}; }
    .sos-send { width: 36px; height: 36px; background: ${CFG.color}; border: none; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: .9rem; color: #07090f; flex-shrink: 0; transition: all .2s; }
    .sos-send:hover { transform: scale(1.08); }
    .sos-send:disabled { opacity: .4; cursor: default; transform: none; }

    @media (max-width: 420px) {
      #sos-widget-panel { width: calc(100vw - 24px); ${CFG.position}: 12px; bottom: 90px; }
      #sos-widget-btn { ${CFG.position}: 16px; bottom: 20px; }
    }
  `;

  // ── MARKUP ───────────────────────────────────────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  const btn = document.createElement('button');
  btn.id = 'sos-widget-btn';
  btn.innerHTML = `<span class="sos-icon">💬</span><span class="sos-close">✕</span>`;

  const panel = document.createElement('div');
  panel.id = 'sos-widget-panel';
  panel.innerHTML = `
    <div class="sos-header">
      <div class="sos-av">AI</div>
      <div class="sos-header-text">
        <div class="sos-title">${CFG.title}</div>
        <div class="sos-sub">${CFG.subtitle}</div>
      </div>
      <div class="sos-powered">Powered by<br><a href="${BASE}" target="_blank">SupportOS</a></div>
    </div>
    <div class="sos-messages" id="sos-messages">
      <div class="sos-msg agent">
        <div class="sos-bubble agent">Hi! I'm ${CFG.agentName}. How can I help you today?</div>
        <div class="sos-time">${fmtTime()}</div>
      </div>
    </div>
    <div class="sos-input-area">
      <textarea class="sos-input" id="sos-input" placeholder="Describe your issue..." rows="1"></textarea>
      <button class="sos-send" id="sos-send">➤</button>
    </div>`;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  // ── LOGIC ────────────────────────────────────────────────────────────────────
  let open = false;
  let busy = false;
  let sessionId = null;

  btn.addEventListener('click', () => {
    open = !open;
    btn.classList.toggle('open', open);
    panel.classList.toggle('open', open);
    if (open) document.getElementById('sos-input')?.focus();
  });

  const input = document.getElementById('sos-input');
  const sendBtn = document.getElementById('sos-send');
  const messages = document.getElementById('sos-messages');

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);

  async function send() {
    const msg = input.value.trim();
    if (!msg || busy) return;
    busy = true;
    sendBtn.disabled = true;
    addMsg(msg, 'user');
    input.value = '';
    input.style.height = 'auto';

    const typing = addTyping();

    try {
      const res = await fetch(`${BASE}/api/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': CFG.key },
        body: JSON.stringify({ message: msg, session_id: sessionId })
      });
      const json = await res.json();
      typing.remove();

      if (json.success && json.data) {
        sessionId = json.session_id;
        const d = json.data;
        const replyEl = addMsg(d.suggested_reply || "I'm reviewing your message now. Let me get back to you shortly.", 'agent');
        if (d.triage?.category) {
          const badge = document.createElement('span');
          badge.className = `sos-badge ${d.triage.category}`;
          badge.textContent = d.triage.category;
          replyEl.appendChild(badge);
        }
      } else {
        addMsg("I'm looking into this for you right now. A member of our team will follow up shortly.", 'agent');
      }
    } catch {
      typing.remove();
      addMsg("Sorry, I'm having trouble connecting. Please try again in a moment.", 'agent');
    }

    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }

  function addMsg(text, role) {
    const div = document.createElement('div');
    div.className = `sos-msg ${role}`;
    div.innerHTML = `<div class="sos-bubble ${role}">${escHtml(text)}</div><div class="sos-time">${fmtTime()}</div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div.querySelector('.sos-bubble');
  }

  function addTyping() {
    const div = document.createElement('div');
    div.className = 'sos-msg agent';
    div.innerHTML = `<div class="sos-typing"><span></span><span></span><span></span></div>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
  }

  function fmtTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

})();
