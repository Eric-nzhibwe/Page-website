/**
 * ARTX AI Chatbot
 * Talks to the Django backend which calls Google Gemini 2.5 Flash.
 */

// ── API base URL — reads from app.js global or builds it here ──────────────
const CHAT_API = (() => {
    // app.js defines API_BASE_URL globally — use it if available
    if (typeof API_BASE_URL !== 'undefined') return API_BASE_URL;
    const h = window.location.hostname;
    return (h === 'localhost' || h === '127.0.0.1')
        ? 'http://localhost:8000/api'
        : `${window.location.origin}/api`;
})();

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
    const header = document.querySelector('.chat-header-status');

    try {
        const res  = await fetch(`${CHAT_API}/chatbot/status/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error();
        const data = await res.json();

        currentAiSource = data.engine;

        if (data.engine === 'gemini') {
            dot.className   = 'status-dot online';
            label.innerHTML = `${data.label} <span class="engine-badge gemini">Gemini</span>`;
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
        ? `<span class="msg-source-badge ${source === 'gemini' ? '' : 'fallback'}">${source === 'gemini' ? '✦ Gemini' : 'Basic'}</span>`
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
