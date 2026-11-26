/**
 * PAGE AI — Chat client
 * ─────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/chatbot/chat/           text chat
 *   POST /api/chatbot/media/          image / file + optional text
 *   POST /api/chatbot/transcribe/     voice recording → text
 *   GET  /api/chatbot/sessions/       sidebar history list
 *   GET  /api/chatbot/sessions/<id>/  load a past session
 *   GET  /api/chatbot/status/         live AI status badge
 */

'use strict';

/* ── API root ──────────────────────────────────────────────────────────── */
const API = (() => {
  if (typeof API_BASE_URL !== 'undefined') return API_BASE_URL;
  const h = window.location.hostname;
  return (h === 'localhost' || h === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;
})();

/* ── State ─────────────────────────────────────────────────────────────── */
let sessionId  = null;
let msgCount   = 0;
let isBusy     = false;
let aiSrc      = 'groq';

/* Voice */
let _recorder  = null;
let _chunks    = [];
let _recTimer  = null;
let _recActive = false;

/* Attachment */
let _file      = null;
let _fileURL   = null;

// Expose for inline scripts
Object.defineProperty(window, '_file', { get: () => _file, configurable: true });

/* ── Boot ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

  /* Auth guard */
  if (typeof window._pageIsAuthed === 'function' && !window._pageIsAuthed()) {
    if (!localStorage.getItem('djangoAuthToken') && !localStorage.getItem('firebaseIdToken')) {
      window.location.href = 'auth.html'; return;
    }
  }

  /* Auto-grow textarea + send button */
  const inp = document.getElementById('aiMsgInput');
  inp.addEventListener('input', () => { _grow(inp); _toggleSend(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('aiForm').dispatchEvent(new Event('submit'));
    }
  });

  /* Mobile keyboard lift via Visual Viewport API */
  if (window.visualViewport) {
    const bar = document.getElementById('inputBar');
    window.visualViewport.addEventListener('resize', () => {
      const kbH = Math.max(0, window.innerHeight - window.visualViewport.height);
      document.documentElement.style.setProperty('--kb-h', kbH + 'px');
    });
  }

  _renderWelcome();
  _checkStatus();
  _loadSessions();
});

/* ── Auth helper ───────────────────────────────────────────────────────── */
function _authHeader() {
  if (typeof window._pageAuthHeader === 'function') return window._pageAuthHeader();
  const tk = localStorage.getItem('djangoAuthToken') || localStorage.getItem('firebaseIdToken');
  return tk ? `Token ${tk}` : null;
}

async function _apiFetch(url, opts = {}) {
  const auth = _authHeader();
  if (!auth) throw new Error('401 — not authenticated');
  opts.headers = { ...(opts.headers || {}), 'Authorization': auth };
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error || ''; } catch { msg = res.statusText; }
    throw new Error(`${res.status} — ${msg}`);
  }
  return res.json();
}

/* ── Status badge ──────────────────────────────────────────────────────── */
async function _checkStatus() {
  const dot   = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);

  try {
    const auth = _authHeader();
    const res  = await fetch(`${API}/chatbot/status/`, {
      headers: auth ? { 'Authorization': auth } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`${res.status}`);
    const d = await res.json();
    aiSrc = d.engine;

    if (d.engine === 'groq' && d.status === 'online') {
      if (dot)   dot.className   = 'ai-status-dot online';
      if (label) label.innerHTML = `${d.label || 'PAGE AI'} <span class="ai-engine-pill live">● Live</span>`;
    } else if (d.status === 'error') {
      if (dot)   dot.className   = 'ai-status-dot error';
      if (label) label.innerHTML = `<span class="ai-engine-pill limited">${d.label || 'Basic Mode'}</span>`;
    } else {
      if (dot)   dot.className   = 'ai-status-dot limited';
      if (label) label.innerHTML = 'Basic Mode <span class="ai-engine-pill limited">Limited</span>';
    }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      if (dot)   dot.className   = 'ai-status-dot online';
      if (label) label.innerHTML = 'PAGE AI <span class="ai-engine-pill live">Ready</span>';
    } else {
      if (dot)   dot.className   = 'ai-status-dot error';
      if (label) label.textContent = 'Offline';
    }
  }
}

/* ── Welcome / empty state ─────────────────────────────────────────────── */
function _renderWelcome() {
  const feed = document.getElementById('aiFeed');
  const isDesktop = window.innerWidth >= 1024;

  if (isDesktop) {
    /* Desktop: centered heading + floating input bar */
    feed.innerHTML = `
      <div class="ai-welcome" id="aiWelcome">
        <h2>What's on your mind today?</h2>
        <div class="ai-welcome-input-wrap" id="welcomeInputWrap">
          <!-- The real input bar stays at the bottom; we clone its look as a hint -->
        </div>
        <div class="ai-starter-chips">
          <button class="ai-starter-chip" onclick="quickSend('How do I deposit funds into my wallet?')">Deposit funds</button>
          <button class="ai-starter-chip" onclick="quickSend('How do I earn money on PAGE?')">Earn money</button>
          <button class="ai-starter-chip" onclick="quickSend('How do tournaments work?')">Tournaments</button>
          <button class="ai-starter-chip" onclick="quickSend('Explain the prestige tier system')">Prestige tiers</button>
          <button class="ai-starter-chip" onclick="quickSend('How do alliances work?')">Alliances</button>
          <button class="ai-starter-chip" onclick="quickSend('What payment methods are supported?')">Payments</button>
        </div>
      </div>`;
  } else {
    feed.innerHTML = `
      <div class="ai-welcome" id="aiWelcome">
        <h2 style="font-size:22px;">Hey, I'm PAGE AI</h2>
        <p style="font-size:14px;color:var(--ai-muted);max-width:320px;text-align:center;line-height:1.6;">
          Ask me anything about PAGE — wallet, challenges, prestige, and more.
        </p>
        <div class="ai-starter-grid">
          <button class="ai-starter-card" onclick="quickSend('How do I deposit funds into my wallet?')">
            <i class="fas fa-wallet"></i><span>Deposit funds</span>
          </button>
          <button class="ai-starter-card" onclick="quickSend('How do I earn money on PAGE?')">
            <i class="fas fa-coins"></i><span>Earn money</span>
          </button>
          <button class="ai-starter-card" onclick="quickSend('How do tournaments work?')">
            <i class="fas fa-trophy"></i><span>Tournaments</span>
          </button>
          <button class="ai-starter-card" onclick="quickSend('Explain the prestige tier system')">
            <i class="fas fa-layer-group"></i><span>Prestige tiers</span>
          </button>
        </div>
      </div>`;
  }

  /* Update topbar title */
  _setTopbarTitle('');
  sessionId = null;
  msgCount  = 0;
}

function _hideWelcome() {
  const ws = document.getElementById('aiWelcome');
  if (!ws) return;
  ws.style.transition = 'opacity 0.2s, transform 0.2s';
  ws.style.opacity    = '0';
  ws.style.transform  = 'translateY(-8px)';
  setTimeout(() => ws.remove(), 220);
}

/* ── New session ───────────────────────────────────────────────────────── */
function newSession() {
  _clearAttach();
  _renderWelcome();
  _updateSidebarActive(null);
  closeSidebar();
}

/* ── Topbar title helper ───────────────────────────────────────────────── */
function _setTopbarTitle(title) {
  const el = document.getElementById('topbarTitle');
  if (el) el.textContent = title || '';
}

/* ── Send text ─────────────────────────────────────────────────────────── */
async function sendMessage(e) {
  e.preventDefault();
  if (isBusy) return;

  const inp  = document.getElementById('aiMsgInput');
  const text = inp.value.trim();
  if (!text && !_file) return;

  /* Reset input */
  inp.value = '';
  inp.style.height = 'auto';
  _toggleSend();
  _hideWelcome();
  closeSidebar();

  /* File / image takes a separate path */
  if (_file) {
    await _sendMedia(text, _file);
    _clearAttach();
    return;
  }

  _appendMsg(text, 'user');
  _setBusy(true);

  try {
    const data = await _apiFetch(`${API}/chatbot/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, session_id: sessionId || undefined }),
    });
    _setBusy(false);
    if (data.session_id) {
      const isNew = !sessionId;
      sessionId = data.session_id;
      if (isNew) {
        _loadSessions();
        _setTopbarTitle(data.title || text.slice(0, 50));
      }
    }
    _appendMsg(data.reply || data.message?.content || '…', 'bot', data.ai_source);
  } catch (err) {
    _setBusy(false);
    _appendErr(_friendlyError(err.message));
  }
}

function quickSend(text) {
  const inp = document.getElementById('aiMsgInput');
  inp.value = text;
  _toggleSend();
  document.getElementById('aiForm').dispatchEvent(new Event('submit'));
}

function _friendlyError(msg) {
  if (msg.includes('401')) return 'Your session expired — please log in again.';
  if (msg.includes('403')) return 'Access denied. Try refreshing the page.';
  if (msg.includes('500')) return 'The AI server hit an error. Give it a moment and try again.';
  if (msg.includes('503')) return 'AI is warming up — wait a few seconds then try again.';
  return `Couldn't reach the server (${msg}) — check your connection.`;
}

/* ── Session history (sidebar) ─────────────────────────────────────────── */
async function _loadSessions() {
  const container = document.getElementById('sidebarHistory');
  if (!container) return;
  try {
    const data     = await _apiFetch(`${API}/chatbot/sessions/`);
    const all      = data.sessions || [];
    const sessions = all.slice(0, 15);
    if (!sessions.length) { container.innerHTML = ''; return; }

    container.innerHTML = '<p class="ai-sidebar-label">Recent chats</p>';
    sessions.forEach(s => {
      const btn      = document.createElement('button');
      btn.className  = `ai-sidebar-row${s.id === sessionId ? ' active' : ''}`;
      btn.dataset.sid = s.id;
      const title    = (s.title || 'Chat').slice(0, 36) + ((s.title?.length || 0) > 36 ? '…' : '');
      btn.innerHTML  = `<i class="fas fa-message"></i><span>${_esc(title)}</span>`;
      btn.addEventListener('click', () => _openSession(s.id));
      container.appendChild(btn);
    });

    if (all.length > 15) {
      const more = document.createElement('button');
      more.className = 'ai-sidebar-see-all';
      more.textContent = 'See all…';
      more.addEventListener('click', () => {
        /* Show all */
        container.querySelectorAll('.ai-sidebar-row[data-sid]').forEach(b => { b.style.display = ''; });
        more.remove();
      });
      container.appendChild(more);
    }
  } catch { /* sidebar history is non-critical */ }
}

async function _openSession(id) {
  if (id === sessionId) { closeSidebar(); return; }
  try {
    const data = await _apiFetch(`${API}/chatbot/sessions/${id}/`);
    sessionId  = id;
    msgCount   = 0;
    const feed = document.getElementById('aiFeed');
    feed.innerHTML = '';
    const msgs = data.messages || [];
    if (msgs.length) {
      msgs.forEach(m => _appendMsg(m.content,
        m.role === 'user' ? 'user' : 'bot',
        m.role === 'assistant' ? (m.meta?.source || 'groq') : null));
    } else {
      _renderWelcome();
    }
    _setTopbarTitle(data.title || '');
    _updateSidebarActive(id);
    closeSidebar();
  } catch (err) { console.error('Failed to load session:', err); }
}

function _updateSidebarActive(id) {
  document.querySelectorAll('.ai-sidebar-row[data-sid]').forEach(b => {
    b.classList.toggle('active', String(b.dataset.sid) === String(id));
  });
}

/* ── Voice recording ───────────────────────────────────────────────────── */
async function startRec(e) {
  if (e && e.cancelable) e.preventDefault();
  if (_recActive || isBusy) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _chunks   = [];
    _recorder = new MediaRecorder(stream, { mimeType: _bestMime() });
    _recorder.ondataavailable = ev => { if (ev.data.size > 0) _chunks.push(ev.data); };
    _recorder.start(100);
    _recActive = true;
    /* Mark all voice buttons as recording */
    ['voiceBtn','voiceBtnDesktop','sidebarVoiceBtn'].forEach(id => {
      const b = document.getElementById(id);
      if (b) { b.classList.add('recording'); b.title = 'Release to send'; }
    });
    _recTimer = setTimeout(() => stopRec(), 60000);
  } catch {
    _appendErr('Could not access microphone — please allow microphone permission.');
  }
}

async function stopRec(e) {
  if (e && e.cancelable) e.preventDefault();
  if (!_recActive || !_recorder) return;
  _recActive = false;
  clearTimeout(_recTimer);
  ['voiceBtn','voiceBtnDesktop','sidebarVoiceBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) { b.classList.remove('recording'); b.title = 'Hold to record'; }
  });
  _recorder.stop();
  _recorder.stream.getTracks().forEach(t => t.stop());
  await new Promise(r => setTimeout(r, 160));

  const blob = new Blob(_chunks, { type: _bestMime() });
  if (blob.size < 800) { _appendErr('Recording too short — hold the mic button longer.'); return; }

  _hideWelcome();
  _appendVoiceBubble();
  _setBusy(true);

  try {
    const transcript = await _transcribe(blob);
    if (!transcript) {
      _setBusy(false);
      _appendErr('Could not understand the audio. Please try again.');
      return;
    }
    _updateVoiceBubble(transcript);
    const data = await _apiFetch(`${API}/chatbot/chat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: transcript, session_id: sessionId || undefined }),
    });
    _setBusy(false);
    if (data.session_id) { const isNew = !sessionId; sessionId = data.session_id; if (isNew) _loadSessions(); }
    _appendMsg(data.reply || data.message?.content || '…', 'bot', data.ai_source);
  } catch (err) {
    _setBusy(false);
    _appendErr(`Voice message failed (${err.message}).`);
  }
}

async function _transcribe(blob) {
  const form = new FormData();
  form.append('audio', blob, `voice_${Date.now()}.webm`);
  const auth = _authHeader();
  const res  = await fetch(`${API}/chatbot/transcribe/`, {
    method: 'POST',
    headers: auth ? { 'Authorization': auth } : {},
    body: form,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `${res.status}`); }
  return (await res.json()).transcript || null;
}

function _bestMime() {
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg','audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
}

/* ── File / image attachment ───────────────────────────────────────────── */
function handleAttach(e) {
  const file = e.target.files[0];
  if (!file) return;
  let mime = file.type || '';
  if (!mime) {
    const ext = file.name.split('.').pop().toLowerCase();
    mime = {png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
            gif:'image/gif',webp:'image/webp',bmp:'image/bmp'}[ext] || 'application/octet-stream';
  }
  const isImg = mime.startsWith('image/');
  const maxMb = isImg ? 10 : 5;
  if (file.size > maxMb * 1024 * 1024) {
    alert(`File is too large. Max ${maxMb} MB.`); e.target.value = ''; return;
  }
  _file = file; _file._mime = mime;

  const strip = document.getElementById('attachStrip');
  strip.innerHTML = '';
  strip.classList.add('visible');

  const chip = document.createElement('div');
  chip.className = 'ai-attach-chip';

  if (isImg) {
    const url = URL.createObjectURL(file); _fileURL = url;
    chip.innerHTML = `
      <img src="${url}" class="ai-attach-thumb" alt="">
      <span class="ai-attach-name">${_esc(file.name)}</span>
      <button type="button" class="ai-attach-remove" onclick="clearAttach()"><i class="fas fa-times"></i></button>`;
  } else {
    chip.innerHTML = `
      <i class="fas fa-file ai-attach-file-icon"></i>
      <span class="ai-attach-name">${_esc(file.name)}</span>
      <button type="button" class="ai-attach-remove" onclick="clearAttach()"><i class="fas fa-times"></i></button>`;
  }
  strip.appendChild(chip);
  _toggleSend();
}

function clearAttach() { _clearAttach(); }
function _clearAttach() {
  _file = null;
  if (_fileURL) { URL.revokeObjectURL(_fileURL); _fileURL = null; }
  const strip = document.getElementById('attachStrip');
  if (strip) { strip.classList.remove('visible'); strip.innerHTML = ''; }
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
  _toggleSend();
}

async function _sendMedia(text, file) {
  const isImg = (file._mime || '').startsWith('image/');
  _hideWelcome();

  /* Show the user's message bubble first */
  if (isImg) {
    const url  = URL.createObjectURL(file);
    const feed = document.getElementById('aiFeed');
    const row  = document.createElement('div');
    row.className = 'ai-msg-row user-row fade-in';
    row.innerHTML = `
      <div class="ai-msg-avatar">${_userAvatarHTML()}</div>
      <div class="ai-bubble-wrap">
        <div class="ai-bubble ai-image-bubble">
          <img src="${url}" alt="${_esc(file.name)}"
               style="max-width:220px;max-height:220px;border-radius:10px;display:block;object-fit:cover;"
               onload="URL.revokeObjectURL(this.src)">
          ${text ? `<p style="margin:5px 0 0;font-size:13px;color:rgba(255,255,255,0.9);">${_md(text)}</p>` : ''}
        </div>
        <div class="ai-msg-meta"><span class="ai-msg-time">${_time()}</span></div>
      </div>`;
    feed.appendChild(row); msgCount++; _scrollDown();
  } else {
    _appendMsg(text ? `${text}\n📎 ${file.name}` : `📎 ${file.name}`, 'user');
  }

  _setBusy(true);
  try {
    const auth = _authHeader();
    const form = new FormData();
    if (text) form.append('message', text);
    const mime = file._mime || file.type || '';
    const blob = (mime && mime !== file.type)
      ? new Blob([await file.arrayBuffer()], { type: mime }) : file;
    form.append('file', blob, file.name);
    if (sessionId) form.append('session_id', sessionId);

    const res  = await fetch(`${API}/chatbot/media/`, {
      method: 'POST',
      headers: auth ? { 'Authorization': auth } : {},
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    _setBusy(false);
    if (!res.ok) { _appendErr(data.error || 'Failed to process file.'); return; }
    if (data.session_id) {
      const isNew = !sessionId; sessionId = data.session_id;
      if (isNew) _loadSessions();
    }
    _appendMsg(data.reply || data.message?.content || '…', 'bot', data.ai_source);
  } catch {
    _setBusy(false);
    _appendErr('Failed to send file — check your connection.');
  }
}

/* ── Message rendering ──────────────────────────────────────────────────── */
function _appendMsg(text, sender, source = null) {
  const feed = document.getElementById('aiFeed');
  const row  = document.createElement('div');
  row.className = `ai-msg-row ${sender === 'user' ? 'user-row' : 'bot-row'}`;

  if (sender === 'user') {
    row.innerHTML = `
      <div class="ai-msg-avatar ai-mobile-only">${_userAvatarHTML()}</div>
      <div class="ai-bubble-wrap">
        <div class="ai-bubble">${_md(text)}</div>
      </div>`;
  } else {
    /* Source badge */
    let badge = '';
    if (source === 'groq') {
      badge = '<span class="ai-src-pill">PAGE AI</span>';
    } else if (source === 'groq-vision') {
      badge = '<span class="ai-src-pill vision">Vision</span>';
    } else if (source) {
      badge = '<span class="ai-src-pill fallback">Basic</span>';
    }

    row.innerHTML = `
      <div class="ai-msg-avatar ai-mobile-only"><i class="fas fa-microchip"></i></div>
      <div class="ai-bubble-wrap" style="flex:1;max-width:100%;">
        <div class="ai-bubble">${_md(text)}</div>
        <div class="ai-reaction-bar">
          <button class="ai-react-btn" title="Thumbs up" onclick="_react(this,'up')"><i class="far fa-thumbs-up"></i></button>
          <button class="ai-react-btn" title="Thumbs down" onclick="_react(this,'down')"><i class="far fa-thumbs-down"></i></button>
          <button class="ai-react-btn" title="Read aloud" onclick="_readAloud(this)"><i class="fas fa-volume-low"></i></button>
          <button class="ai-react-btn" title="Copy" onclick="_copyMsg(this)"><i class="fas fa-arrow-up-from-bracket"></i></button>
          <button class="ai-react-btn" title="More"><i class="fas fa-ellipsis"></i></button>
          ${badge ? `<span style="margin-left:4px;">${badge}</span>` : ''}
        </div>
      </div>`;
  }

  feed.appendChild(row); msgCount++; _scrollDown();
}

/* ── Reaction helpers ───────────────────────────────────────────────────── */
function _react(btn, dir) {
  const icon = btn.querySelector('i');
  const isUp = dir === 'up';
  /* Toggle fill */
  if (icon.classList.contains(isUp ? 'fa-solid' : 'fas')) {
    icon.className = isUp ? 'far fa-thumbs-up' : 'far fa-thumbs-down';
    btn.style.color = '';
  } else {
    icon.className = isUp ? 'fas fa-thumbs-up' : 'fas fa-thumbs-down';
    btn.style.color = isUp ? '#22c55e' : '#ef4444';
  }
}
function _readAloud(btn) {
  /* Find the bubble content above the reaction bar */
  const bubble = btn.closest('.ai-bubble-wrap').querySelector('.ai-bubble');
  const text   = bubble ? bubble.innerText : '';
  if (!text) return;
  window.speechSynthesis?.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  window.speechSynthesis?.speak(utt);
  btn.querySelector('i').className = 'fas fa-volume-high';
  utt.onend = () => { btn.querySelector('i').className = 'fas fa-volume-low'; };
}
function _copyMsg(btn) {
  const bubble = btn.closest('.ai-bubble-wrap').querySelector('.ai-bubble');
  if (!bubble) return;
  navigator.clipboard?.writeText(bubble.innerText || '').then(() => {
    const icon = btn.querySelector('i');
    icon.className = 'fas fa-check';
    setTimeout(() => { icon.className = 'fas fa-arrow-up-from-bracket'; }, 1500);
  });
}

function _appendErr(text) {
  const feed = document.getElementById('aiFeed');
  const row  = document.createElement('div');
  row.className = 'ai-msg-row bot-row fade-in';
  row.innerHTML = `
    <div class="ai-msg-avatar"><i class="fas fa-microchip"></i></div>
    <div class="ai-bubble-wrap">
      <div class="ai-bubble error-bubble">${_esc(text)}</div>
      <div class="ai-msg-meta"><span class="ai-msg-time">${_time()}</span></div>
    </div>`;
  feed.appendChild(row); _scrollDown();
}

function _appendVoiceBubble() {
  const feed = document.getElementById('aiFeed');
  const row  = document.createElement('div');
  row.className = 'ai-msg-row user-row fade-in';
  row.id = '_voiceRow';
  row.innerHTML = `
    <div class="ai-msg-avatar">${_userAvatarHTML()}</div>
    <div class="ai-bubble-wrap">
      <div class="ai-bubble ai-voice-bubble">
        <i class="fas fa-microphone-alt" style="color:#bef264;margin-right:6px;"></i>
        <span id="_voiceText"><em style="opacity:0.75;">Transcribing…</em></span>
      </div>
      <div class="ai-msg-meta">
        <span class="ai-msg-time">${_time()}</span>
        <span class="ai-src-pill">🎙 Voice</span>
      </div>
    </div>`;
  feed.appendChild(row); msgCount++; _scrollDown();
}

function _updateVoiceBubble(transcript) {
  const el = document.getElementById('_voiceText');
  if (el) el.textContent = `"${transcript}"`;
  const row = document.getElementById('_voiceRow');
  if (row) row.removeAttribute('id');
}

/* ── User avatar ────────────────────────────────────────────────────────── */
function _userAvatarHTML() {
  try {
    const u = JSON.parse(localStorage.getItem('pageUser') || '{}');
    if (typeof avatarHTML === 'function')
      return avatarHTML(u, 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;');
    const raw  = u.profile_image_url || u.avatar_url || null;
    const url  = raw ? (typeof resolveMediaUrl === 'function' ? resolveMediaUrl(raw) : raw) : null;
    const init = (u.display_name || u.username || 'Y').charAt(0).toUpperCase();
    if (url)
      return `<img src="${url}" alt="${init}"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"
        onerror="this.style.display='none'">`;
    return `<span style="display:flex;align-items:center;justify-content:center;
      width:100%;height:100%;border-radius:50%;
      background:var(--ai-gradient-msg);color:#fff;font-weight:700;font-size:14px;">${init}</span>`;
  } catch { return ''; }
}

/* ── Markdown renderer ──────────────────────────────────────────────────── */
function _md(raw) {
  let t = _esc(String(raw));
  /* Code blocks */
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g,
    (_, lang, code) => `<pre><code class="lang-${lang||'text'}">${code.trim()}</code></pre>`);
  t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  /* Headings */
  t = t.replace(/^### (.+)$/gm,'<h3>$1</h3>')
       .replace(/^## (.+)$/gm, '<h2>$1</h2>')
       .replace(/^# (.+)$/gm,  '<h1>$1</h1>');
  /* Bold / italic */
  t = t.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
       .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
       .replace(/\*([^\s*][^*]*[^\s*])\*/g,'<em>$1</em>');
  /* HR */
  t = t.replace(/^[-*_]{3,}$/gm,'<hr>');
  /* Links */
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  /* Lists — group consecutive lines into a single <ul> or <ol> */
  t = t.replace(/((?:^[ \t]*[-•*] .+\n?)+)/gm, block => {
    const items = block.trim().split('\n').map(l => l.replace(/^[ \t]*[-•*] /, '').trim());
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });
  t = t.replace(/((?:^[ \t]*\d+\. .+\n?)+)/gm, block => {
    const items = block.trim().split('\n').map(l => l.replace(/^[ \t]*\d+\. /, '').trim());
    return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
  });
  /* Newlines */
  t = t.replace(/\n/g,'<br>');
  return t;
}

function _esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── UI helpers ─────────────────────────────────────────────────────────── */
function _setBusy(on) {
  isBusy = on;
  document.getElementById('typingRow').style.display = on ? 'flex' : 'none';
  _toggleSend();
  if (on) _scrollDown();
}

function _scrollDown() {
  const feed = document.getElementById('aiFeed');
  requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
}

function _grow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

function _toggleSend() {
  const inp      = document.getElementById('aiMsgInput');
  const hasContent = inp.value.trim() !== '' || !!_file;
  const disabled = !hasContent || isBusy;
  const btn      = document.getElementById('aiSendBtn');
  const mBtn     = document.getElementById('aiSendBtnMobile');
  if (btn)  btn.disabled  = disabled;
  if (mBtn) mBtn.disabled = disabled;

  /* Mobile orb icon: waveform when idle, paper-plane when typing */
  const mIcon = document.getElementById('voiceOrbIcon');
  if (mIcon) mIcon.className = hasContent ? 'fas fa-paper-plane' : 'fas fa-waveform-lines';

  /* Desktop orb icon: same logic */
  const dIcon = document.getElementById('desktopOrbIcon');
  if (dIcon) dIcon.className = hasContent ? 'fas fa-paper-plane' : 'fas fa-waveform-lines';

  /* Style desktop send button: blue when active */
  if (btn) {
    btn.style.background = hasContent && !isBusy ? '#2563eb' : '';
    btn.style.boxShadow  = hasContent && !isBusy ? '0 4px 12px rgba(37,99,235,0.3)' : '';
  }
}

function _time() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
