/**
 * ARTX AI Chatbot
 * Talks to the Django backend which calls Groq.
 * Supports: text, voice recording (Whisper transcription), image & file upload.
 */

const CHAT_API = (() => {
    if (typeof API_BASE_URL !== 'undefined') return API_BASE_URL;
    const h = window.location.hostname;
    return (h === 'localhost' || h === '127.0.0.1')
        ? 'http://localhost:8000/api'
        : `${window.location.origin}/api`;
})();

// ── State ──────────────────────────────────────────────────────────────────
let conversationId  = null;
let messageCount    = 0;
let isWaiting       = false;
let currentAiSource = 'groq';

// Voice recording state
let _mediaRecorder  = null;
let _audioChunks    = [];
let _recordingTimer = null;
let _isRecording    = false;

// File attachment state
let _attachedFile   = null;    // File object
let _attachedPreviewUrl = null;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = 'auth.html'; return; }

    const input = document.getElementById('messageInput');
    input.addEventListener('input', () => { autoGrow(input); toggleSendBtn(); });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('chatForm').dispatchEvent(new Event('submit'));
        }
    });

    checkAiStatus();
    loadHistory();
});

// ── Input helpers ──────────────────────────────────────────────────────────
function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function toggleSendBtn() {
    const input = document.getElementById('messageInput');
    const btn   = document.getElementById('sendBtn');
    btn.disabled = (input.value.trim() === '' && !_attachedFile) || isWaiting;
}

// ── AI status badge ────────────────────────────────────────────────────────
async function checkAiStatus() {
    const token = localStorage.getItem('djangoAuthToken');
    const label = document.getElementById('aiStatusLabel');
    const dot   = document.querySelector('.status-dot');
    dot.className = 'status-dot';
    label.innerHTML = 'Checking…';
    try {
        const res  = await fetch(`${CHAT_API}/chatbot/status/`, { headers: { 'Authorization': `Token ${token}` } });
        if (!res.ok) throw new Error();
        const data = await res.json();
        currentAiSource = data.engine;
        if (data.engine === 'groq' && data.status === 'online') {
            dot.className   = 'status-dot online';
            label.innerHTML = `${data.label} <span class="engine-badge">✓ Live</span>`;
        } else if (data.status === 'error') {
            dot.className   = 'status-dot error';
            label.innerHTML = `<span class="engine-badge fallback">${data.label}</span>`;
        } else {
            dot.className   = 'status-dot limited';
            label.innerHTML = 'Basic Mode <span class="engine-badge fallback">Limited</span>';
        }
    } catch {
        dot.className = 'status-dot error';
        label.textContent = 'Offline';
    }
}

// ── Send text message ──────────────────────────────────────────────────────
async function sendMessage(event) {
    event.preventDefault();
    if (isWaiting) return;

    const input   = document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message && !_attachedFile) return;

    input.value = '';
    input.style.height = 'auto';
    toggleSendBtn();
    hideWelcome();

    if (_attachedFile) {
        await sendMediaMessage(message, _attachedFile);
        clearAttachment();
        return;
    }

    appendMessage(message, 'user');
    setWaiting(true);

    try {
        const data    = await callBackend(message);
        const content = data?.ai_message?.content;
        const source  = data?.ai_source || currentAiSource;
        setWaiting(false);
        if (content) appendMessage(content, 'bot', source);
        else appendMessage('Sorry, no response. Please try again.', 'bot', 'fallback', true);
    } catch (err) {
        setWaiting(false);
        appendMessage('Connection error — please check your network.', 'bot', 'fallback', true);
    }
}

function sendQuickMessage(text) {
    const input = document.getElementById('messageInput');
    input.value = text;
    toggleSendBtn();
    document.getElementById('chatForm').dispatchEvent(new Event('submit'));
}

async function callBackend(message) {
    const token = localStorage.getItem('djangoAuthToken');
    const res   = await fetch(`${CHAT_API}/chatbot/chat/`, {
        method:  'POST',
        headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message, conversation_id: conversationId || undefined }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.conversation_id) conversationId = data.conversation_id;
    return data;
}

// ── Voice recording ────────────────────────────────────────────────────────
async function startRecording() {
    if (_isRecording || isWaiting) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _audioChunks  = [];
        _mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedAudioMime() });

        _mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) _audioChunks.push(e.data);
        };

        _mediaRecorder.start(100);
        _isRecording = true;

        // Visual feedback
        const btn = document.getElementById('voiceBtn');
        btn.classList.add('recording');
        btn.title = 'Release to send';

        // Safety: auto-stop after 60s
        _recordingTimer = setTimeout(() => stopRecording(), 60000);

    } catch (err) {
        console.error('Microphone error:', err);
        appendMessage('Could not access microphone. Please allow microphone permission.', 'bot', 'fallback', true);
    }
}

async function stopRecording() {
    if (!_isRecording || !_mediaRecorder) return;
    _isRecording = false;
    clearTimeout(_recordingTimer);

    const btn = document.getElementById('voiceBtn');
    btn.classList.remove('recording');
    btn.title = 'Hold to record voice message';

    // Collect remaining chunks
    _mediaRecorder.stop();
    _mediaRecorder.stream.getTracks().forEach(t => t.stop());

    // Wait for the final ondataavailable event
    await new Promise(res => setTimeout(res, 150));

    const audioBlob = new Blob(_audioChunks, { type: getSupportedAudioMime() });

    if (audioBlob.size < 1000) {
        appendMessage('Recording too short. Hold the mic button longer.', 'bot', 'fallback', true);
        return;
    }

    // Show user a "voice message" bubble
    hideWelcome();
    appendVoiceBubble('user');
    setWaiting(true);

    try {
        const transcript = await transcribeAudio(audioBlob);
        if (!transcript) {
            setWaiting(false);
            appendMessage('Could not understand the audio. Please try again.', 'bot', 'fallback', true);
            return;
        }

        // Update the voice bubble with the transcript
        updateLastVoiceBubbleTranscript(transcript);

        // Send as a regular text message
        const data    = await callBackend(transcript);
        const content = data?.ai_message?.content;
        const source  = data?.ai_source || currentAiSource;
        setWaiting(false);
        if (content) appendMessage(content, 'bot', source);
        else appendMessage('Sorry, no response. Please try again.', 'bot', 'fallback', true);

    } catch (err) {
        setWaiting(false);
        appendMessage('Voice message failed. Please try again.', 'bot', 'fallback', true);
    }
}

async function transcribeAudio(blob) {
    const token   = localStorage.getItem('djangoAuthToken');
    const formData = new FormData();
    formData.append('audio', blob, `voice_${Date.now()}.webm`);

    const res = await fetch(`${CHAT_API}/chatbot/transcribe/`, {
        method:  'POST',
        headers: { 'Authorization': `Token ${token}` },
        body:    formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.transcript;
}

function getSupportedAudioMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
}

// ── File / image attachment ────────────────────────────────────────────────
function handleFileAttach(event) {
    const file = event.target.files[0];
    if (!file) return;

    const maxMb = file.type.startsWith('image/') ? 10 : 5;
    if (file.size > maxMb * 1024 * 1024) {
        alert(`File too large. Max ${maxMb} MB.`);
        event.target.value = '';
        return;
    }

    _attachedFile = file;

    const preview = document.getElementById('attachmentPreview');
    preview.style.display = 'flex';

    if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        _attachedPreviewUrl = url;
        preview.innerHTML = `
            <div class="attachment-chip">
                <img src="${url}" alt="attachment" class="attachment-thumb">
                <span class="attachment-name">${file.name}</span>
                <button type="button" onclick="clearAttachment()" class="attachment-remove"><i class="fas fa-times"></i></button>
            </div>`;
    } else {
        preview.innerHTML = `
            <div class="attachment-chip">
                <i class="fas fa-file attachment-file-icon"></i>
                <span class="attachment-name">${file.name}</span>
                <button type="button" onclick="clearAttachment()" class="attachment-remove"><i class="fas fa-times"></i></button>
            </div>`;
    }

    toggleSendBtn();
}

function clearAttachment() {
    _attachedFile = null;
    if (_attachedPreviewUrl) { URL.revokeObjectURL(_attachedPreviewUrl); _attachedPreviewUrl = null; }
    const preview = document.getElementById('attachmentPreview');
    preview.style.display = 'none';
    preview.innerHTML = '';
    document.getElementById('fileInput').value = '';
    toggleSendBtn();
}

async function sendMediaMessage(message, file) {
    // Show user bubble with file info
    const displayMsg = message
        ? `${message}\n📎 ${file.name}`
        : `📎 ${file.name}`;
    appendMessage(displayMsg, 'user');
    setWaiting(true);

    try {
        const token    = localStorage.getItem('djangoAuthToken');
        const formData = new FormData();
        if (message) formData.append('message', message);
        formData.append('file', file, file.name);
        if (conversationId) formData.append('conversation_id', conversationId);

        const res = await fetch(`${CHAT_API}/chatbot/media-chat/`, {
            method:  'POST',
            headers: { 'Authorization': `Token ${token}` },
            body:    formData,
        });

        const data = await res.json().catch(() => ({}));
        setWaiting(false);

        if (!res.ok) {
            appendMessage(data.error || 'Failed to process file.', 'bot', 'fallback', true);
            return;
        }

        if (data.conversation_id) conversationId = data.conversation_id;
        const content = data?.ai_message?.content;
        const source  = data?.ai_source || currentAiSource;
        if (content) appendMessage(content, 'bot', source);
        else appendMessage('No response received. Please try again.', 'bot', 'fallback', true);

    } catch (err) {
        setWaiting(false);
        appendMessage('Failed to send file. Check your connection.', 'bot', 'fallback', true);
    }
}

// ── Message rendering ──────────────────────────────────────────────────────
function appendMessage(text, sender, source = null, isError = false) {
    const feed = document.getElementById('chatMessages');
    const row  = document.createElement('div');
    row.className = `msg-row ${sender === 'user' ? 'user-row' : 'bot-row'} fade-in`;

    const time        = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    const sourceBadge = (sender === 'bot' && source)
        ? `<span class="msg-source-badge ${source.includes('fallback') ? 'fallback' : ''}">${source === 'groq' ? '✦ Groq' : source === 'groq-vision' ? '✦ Vision' : 'Basic'}</span>`
        : '';

    row.innerHTML = `
        <div class="msg-avatar"><i class="fas fa-${sender === 'user' ? 'user' : 'robot'}"></i></div>
        <div class="msg-bubble-wrap">
            <div class="msg-bubble ${isError ? 'error-bubble' : ''}">${renderMarkdown(text)}</div>
            <div class="msg-meta"><span class="msg-time">${time}</span>${sourceBadge}</div>
        </div>`;

    feed.appendChild(row);
    messageCount++;
    scrollToBottom();
}

function appendVoiceBubble(sender) {
    const feed = document.getElementById('chatMessages');
    const row  = document.createElement('div');
    row.className = `msg-row ${sender === 'user' ? 'user-row' : 'bot-row'} fade-in`;
    row.id = 'lastVoiceBubble';
    const time = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    row.innerHTML = `
        <div class="msg-avatar"><i class="fas fa-user"></i></div>
        <div class="msg-bubble-wrap">
            <div class="msg-bubble voice-bubble">
                <i class="fas fa-microphone-alt" style="margin-right:6px;color:#e63946;"></i>
                <span class="voice-transcript-text"><em>Transcribing…</em></span>
            </div>
            <div class="msg-meta"><span class="msg-time">${time}</span><span class="msg-source-badge">🎙 Voice</span></div>
        </div>`;
    feed.appendChild(row);
    messageCount++;
    scrollToBottom();
}

function updateLastVoiceBubbleTranscript(transcript) {
    const bubble = document.getElementById('lastVoiceBubble');
    if (bubble) {
        const el = bubble.querySelector('.voice-transcript-text');
        if (el) el.innerHTML = `"${transcript}"`;
        bubble.removeAttribute('id');
    }
}

// ── Markdown renderer (unchanged) ─────────────────────────────────────────
function renderMarkdown(raw) {
    let t = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_,lang,code) => `<pre><code class="lang-${lang||'text'}">${code.trim()}</code></pre>`);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    t = t.replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>');
    t = t.replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*([^\s*][^*]*[^\s*])\*/g,'<em>$1</em>');
    t = t.replace(/^[-*_]{3,}$/gm,'<hr>');
    t = t.replace(/^[ \t]*[-•*]\s+(.+)$/gm,'<li>$1</li>').replace(/^[ \t]*\d+\.\s+(.+)$/gm,'<oli>$1</oli>');
    t = t.replace(/(<li>[\s\S]+?<\/li>)/g, m => /<ol>/.test(m) ? m : '<ul>'+m+'</ul>');
    t = t.replace(/(<oli>[\s\S]+?<\/oli>)/g, m => '<ol>'+m.replace(/<\/?oli>/g,x=>x.replace('oli','li'))+'</ol>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,'$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    t = t.replace(/\n/g,'<br>');
    return t;
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function setWaiting(on) {
    isWaiting = on;
    document.getElementById('typingIndicator').style.display = on ? 'flex' : 'none';
    toggleSendBtn();
    if (on) scrollToBottom();
}

function scrollToBottom() {
    const feed = document.getElementById('chatMessages');
    requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
}

function hideWelcome() {
    const ws = document.getElementById('welcomeScreen');
    if (ws) { ws.style.transition='opacity .2s'; ws.style.opacity='0'; setTimeout(()=>ws.remove(),200); }
}

// ── History ────────────────────────────────────────────────────────────────
async function loadHistory() {
    const token = localStorage.getItem('djangoAuthToken');
    try {
        const res  = await fetch(`${CHAT_API}/chatbot/history/`, { headers: { 'Authorization': `Token ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const conv = data?.conversations?.[0];
        if (!conv?.messages?.length) return;
        conversationId = conv.id;
        hideWelcome();
        conv.messages.forEach(msg => {
            if (msg.role === 'user') appendMessage(msg.content, 'user');
            else if (msg.role === 'assistant') appendMessage(msg.content, 'bot', 'groq');
        });
    } catch { /* new conversation */ }
}

// ── Clear conversation ─────────────────────────────────────────────────────
function clearConversation() {
    conversationId = null;
    messageCount   = 0;
    clearAttachment();
    const feed = document.getElementById('chatMessages');
    feed.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-orb"><i class="fas fa-microchip"></i></div>
            <h2>ARTX AI Assistant</h2>
            <p>Powered by Groq. Ask me anything — or send a voice message or image.</p>
            <div class="starter-grid">
                <button class="starter-card" onclick="sendQuickMessage('How do I deposit funds into my wallet?')"><i class="fas fa-wallet"></i><span>Deposit funds</span></button>
                <button class="starter-card" onclick="sendQuickMessage('How do I earn money on ARTX?')"><i class="fas fa-coins"></i><span>Earn money</span></button>
                <button class="starter-card" onclick="sendQuickMessage('How do tournaments work?')"><i class="fas fa-trophy"></i><span>Tournaments</span></button>
                <button class="starter-card" onclick="sendQuickMessage('Explain the prestige tier system')"><i class="fas fa-star"></i><span>Prestige tiers</span></button>
                <button class="starter-card" onclick="sendQuickMessage('What payment methods does ARTX support?')"><i class="fas fa-credit-card"></i><span>Payments</span></button>
                <button class="starter-card" onclick="sendQuickMessage('How do alliances work?')"><i class="fas fa-users"></i><span>Alliances</span></button>
            </div>
        </div>`;
}


// ── State ──────────────────────────────────────────────────────────────────
let conversationId  = null;
let messageCount    = 0;        // counts actual exchanges (hides welcome screen)
let isWaiting       = false;    // blocks double-sends
let currentAiSource = 'gemini'; // 'gemini' | 'fallback'

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Auth guard
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) {
        window.location.href = 'auth.html';
        return;
    }

    // Wire input
    const input = document.getElementById('messageInput');
    input.addEventListener('input', () => {
        autoGrow(input);
        toggleSendBtn();
    });
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('chatForm').dispatchEvent(new Event('submit'));
        }
    });

    // Check which AI engine is running → show status badge
    checkAiStatus();

    // Load last conversation
    loadHistory();
});

// ── Input helpers ──────────────────────────────────────────────────────────
function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function toggleSendBtn() {
    const input = document.getElementById('messageInput');
    const btn   = document.getElementById('sendBtn');
    btn.disabled = input.value.trim() === '' || isWaiting;
}

// ── AI engine status badge ─────────────────────────────────────────────────
async function checkAiStatus() {
    const token  = localStorage.getItem('djangoAuthToken');
    const label  = document.getElementById('aiStatusLabel');
    const dot    = document.querySelector('.status-dot');

    // Show "checking" while we wait
    dot.className   = 'status-dot';
    label.innerHTML = 'Checking…';

    try {
        const res  = await fetch(`${CHAT_API}/chatbot/status/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        currentAiSource = data.engine;

        if (data.engine === 'groq' && data.status === 'online') {
            dot.className   = 'status-dot online';
            label.innerHTML = `${data.label} <span class="engine-badge gemini">✓ Live</span>`;
        } else if (data.status === 'error') {
            dot.className   = 'status-dot error';
            label.innerHTML = `<span class="engine-badge fallback">${data.label}</span>`;
        } else {
            dot.className   = 'status-dot limited';
            label.innerHTML = `Basic Mode <span class="engine-badge fallback">Limited</span>`;
        }
    } catch {
        dot.className = 'status-dot error';
        label.textContent = 'Offline';
    }
}

// ── Send message ───────────────────────────────────────────────────────────
async function sendMessage(event) {
    event.preventDefault();
    if (isWaiting) return;

    const input   = document.getElementById('messageInput');
    const message = input.value.trim();
    if (!message) return;

    // Reset input
    input.value = '';
    input.style.height = 'auto';
    toggleSendBtn();

    // Hide welcome screen on first message
    hideWelcome();

    // Show user bubble
    appendMessage(message, 'user');

    // Show typing indicator
    setWaiting(true);

    try {
        const data = await callBackend(message);
        setWaiting(false);

        const content = data?.ai_message?.content;
        const source  = data?.ai_source || currentAiSource;

        if (content) {
            appendMessage(content, 'bot', source);
        } else {
            appendMessage('Sorry, I didn\'t get a response. Please try again.', 'bot', 'fallback', true);
        }
    } catch (err) {
        console.error('Chat error:', err);
        setWaiting(false);
        appendMessage('Connection error — please check your network and try again.', 'bot', 'fallback', true);
    }
}

function sendQuickMessage(text) {
    const input = document.getElementById('messageInput');
    input.value = text;
    toggleSendBtn();
    document.getElementById('chatForm').dispatchEvent(new Event('submit'));
}

// ── Backend call ───────────────────────────────────────────────────────────
async function callBackend(message) {
    const token = localStorage.getItem('djangoAuthToken');

    const res = await fetch(`${CHAT_API}/chatbot/chat/`, {
        method: 'POST',
        headers: {
            'Authorization':  `Token ${token}`,
            'Content-Type':   'application/json',
        },
        body: JSON.stringify({
            message,
            conversation_id: conversationId || undefined,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.conversation_id) conversationId = data.conversation_id;
    return data;
}

// ── Render a message bubble ────────────────────────────────────────────────
function appendMessage(text, sender, source = null, isError = false) {
    const feed = document.getElementById('chatMessages');

    const row = document.createElement('div');
    row.className = `msg-row ${sender === 'user' ? 'user-row' : 'bot-row'} fade-in`;

    const time = new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });

    const sourceBadge = (sender === 'bot' && source)
        ? `<span class="msg-source-badge ${source === 'groq' ? '' : 'fallback'}">${source === 'groq' ? '✦ Groq' : 'Basic'}</span>`
        : '';

    row.innerHTML = `
        <div class="msg-avatar">
            <i class="fas fa-${sender === 'user' ? 'user' : 'robot'}"></i>
        </div>
        <div class="msg-bubble-wrap">
            <div class="msg-bubble ${isError ? 'error-bubble' : ''}">
                ${renderMarkdown(text)}
            </div>
            <div class="msg-meta">
                <span class="msg-time">${time}</span>
                ${sourceBadge}
            </div>
        </div>
    `;

    feed.appendChild(row);
    messageCount++;
    scrollToBottom();
}

// ── Markdown → safe HTML ───────────────────────────────────────────────────
function renderMarkdown(raw) {
    // 1. HTML-escape first (prevent XSS)
    let t = raw
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;');

    // 2. Fenced code blocks
    t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
        `<pre><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`
    );

    // 3. Inline code
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // 4. Headings
    t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
    t = t.replace(/^# (.+)$/gm,   '<h1>$1</h1>');

    // 5. Bold / italic
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>');
    t = t.replace(/\*([^\s*][^*]*[^\s*])\*/g, '<em>$1</em>');

    // 6. Horizontal rule
    t = t.replace(/^[-*_]{3,}$/gm, '<hr>');

    // 7. Unordered lists  (- item or • item)
    t = t.replace(/^[ \t]*[-•*]\s+(.+)$/gm, '<li>$1</li>');

    // 8. Ordered lists  (1. item)
    t = t.replace(/^[ \t]*\d+\.\s+(.+)$/gm, '<oli>$1</oli>');

    // 9. Wrap <li> runs in <ul>
    t = t.replace(/(<li>[\s\S]+?<\/li>)/g, m => {
        if (/<ol>/.test(m)) return m;
        return '<ul>' + m + '</ul>';
    });

    // 10. Wrap <oli> runs in <ol> and rename tags
    t = t.replace(/(<oli>[\s\S]+?<\/oli>)/g, m =>
        '<ol>' + m.replace(/<\/?oli>/g, t2 => t2.replace('oli','li')) + '</ol>'
    );

    // 11. Links  [text](url)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // 12. Bare URLs
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

    // 13. Line breaks (skip inside block elements)
    t = t.replace(/\n/g, '<br>');

    return t;
}

// ── Typing / waiting state ─────────────────────────────────────────────────
function setWaiting(on) {
    isWaiting = on;
    document.getElementById('typingIndicator').style.display = on ? 'flex' : 'none';
    toggleSendBtn();
    if (on) scrollToBottom();
}

// ── Scroll ─────────────────────────────────────────────────────────────────
function scrollToBottom() {
    const feed = document.getElementById('chatMessages');
    requestAnimationFrame(() => { feed.scrollTop = feed.scrollHeight; });
}

// ── Welcome screen ─────────────────────────────────────────────────────────
function hideWelcome() {
    const ws = document.getElementById('welcomeScreen');
    if (ws) {
        ws.style.transition = 'opacity .2s';
        ws.style.opacity    = '0';
        setTimeout(() => ws.remove(), 200);
    }
}

// ── Load conversation history ──────────────────────────────────────────────
async function loadHistory() {
    const token = localStorage.getItem('djangoAuthToken');
    try {
        const res = await fetch(`${CHAT_API}/chatbot/history/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) return;

        const data = await res.json();
        const conv = data?.conversations?.[0];
        if (!conv?.messages?.length) return;

        conversationId = conv.id;
        hideWelcome();

        // Serializer returns {role, content} per message
        conv.messages.forEach(msg => {
            if (msg.role === 'user') {
                appendMessage(msg.content, 'user');
            } else if (msg.role === 'assistant') {
                appendMessage(msg.content, 'bot', 'gemini');
            }
        });
    } catch { /* silent — new conversation */ }
}

// ── Clear conversation ─────────────────────────────────────────────────────
function clearConversation() {
    conversationId = null;
    messageCount   = 0;

    const feed = document.getElementById('chatMessages');
    feed.innerHTML = `
        <div class="welcome-screen" id="welcomeScreen">
            <div class="welcome-orb"><i class="fas fa-robot"></i></div>
            <h2>ARTX AI Assistant</h2>
            <p>Powered by Google Gemini. Ask me anything about the platform — or anything at all.</p>
            <div class="starter-grid">
                <button class="starter-card" onclick="sendQuickMessage('How do I deposit funds into my wallet?')">
                    <i class="fas fa-wallet"></i><span>Deposit funds</span>
                </button>
                <button class="starter-card" onclick="sendQuickMessage('How do I earn money on ARTX?')">
                    <i class="fas fa-coins"></i><span>Earn money</span>
                </button>
                <button class="starter-card" onclick="sendQuickMessage('How do tournaments work?')">
                    <i class="fas fa-trophy"></i><span>Tournaments</span>
                </button>
                <button class="starter-card" onclick="sendQuickMessage('Explain the prestige tier system')">
                    <i class="fas fa-star"></i><span>Prestige tiers</span>
                </button>
                <button class="starter-card" onclick="sendQuickMessage('What payment methods does ARTX support?')">
                    <i class="fas fa-credit-card"></i><span>Payments</span>
                </button>
                <button class="starter-card" onclick="sendQuickMessage('How do alliances work?')">
                    <i class="fas fa-users"></i><span>Alliances</span>
                </button>
            </div>
        </div>
    `;
}
