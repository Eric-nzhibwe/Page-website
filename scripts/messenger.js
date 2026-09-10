/**
 * ARTX Messenger — Direct Message UI
 * ====================================
 * Talks to the existing Django messenger REST API:
 *   GET    /api/messenger/conversations/
 *   POST   /api/messenger/conversations/start_conversation/
 *   GET    /api/messenger/conversations/{id}/messages/
 *   POST   /api/messenger/conversations/{id}/send_message/
 *   GET    /api/messenger/users/
 *   GET    /api/messenger/unread-count/
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const _dm = {
    conversations:      [],
    activeConvId:       null,
    pollInterval:       null,
    msgPollInterval:    null,
    pendingMedia:       null,   // { file, dataUrl }
    searchDebounce:     null,
};

const DM_API = {
    conversations:  ()    => apiService.get('/messenger/conversations/'),
    startConv:      (uid) => apiService.post('/messenger/conversations/start_conversation/', { user_id: uid }),
    messages:       (id)  => apiService.get(`/messenger/conversations/${id}/messages/?page_size=100`),
    sendMessage:    (id, data) => {
        if (data instanceof FormData) {
            return apiService.request(`/messenger/conversations/${id}/send_message/`, {
                method:  'POST',
                body:    data,
                headers: apiService.token ? { Authorization: `Token ${apiService.token}` } : {},
            });
        }
        return apiService.post(`/messenger/conversations/${id}/send_message/`, data);
    },
    availableUsers: (q)   => apiService.get(`/messenger/available-users/${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    unreadCount:    ()    => apiService.get('/messenger/unread-count/'),
};

// ── Init (called when messenger view becomes active) ──────────────────────────
async function dmInit() {
    await dmLoadConversations();
    dmStartPolling();
    // Handle deep-link: index.html#messenger?conv=<id>
    const hash = window.location.hash;
    const match = hash.match(/conv=([^&]+)/);
    if (match) {
        setTimeout(() => dmOpenConversation(match[1]), 600);
    }
}

// ── Polling ───────────────────────────────────────────────────────────────────
function dmStartPolling() {
    clearInterval(_dm.pollInterval);
    _dm.pollInterval = setInterval(dmRefreshConversations, 8000);
}

function dmStopPolling() {
    clearInterval(_dm.pollInterval);
    clearInterval(_dm.msgPollInterval);
}

async function dmRefreshConversations() {
    try {
        const data = await DM_API.conversations();
        _dm.conversations = Array.isArray(data) ? data : (data.results || []);
        dmRenderConvList(_dm.conversations);
        dmUpdateBadge();
    } catch (_) { /* silent background refresh */ }
}

// ── Load conversations ────────────────────────────────────────────────────────
async function dmLoadConversations() {
    const list = document.getElementById('dmConvList');
    if (list) list.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';

    try {
        const data = await DM_API.conversations();
        _dm.conversations = Array.isArray(data) ? data : (data.results || []);
        dmRenderConvList(_dm.conversations);
        dmUpdateBadge();
    } catch (e) {
        if (list) list.innerHTML = '<div class="dm-empty-state">Could not load conversations.</div>';
    }
}

function dmRenderConvList(convs) {
    const list = document.getElementById('dmConvList');
    if (!list) return;

    if (!convs.length) {
        list.innerHTML = `<div class="dm-empty-state">
            <i class="fas fa-comment-slash" style="font-size:32px;opacity:0.25;display:block;margin-bottom:10px;"></i>
            No conversations yet.<br>Tap <strong>✏️</strong> to start one.
        </div>`;
        return;
    }

    const currentUserId = _dmCurrentUserId();

    list.innerHTML = convs.map(conv => {
        const other     = _dmOtherParticipant(conv, currentUserId);
        const last      = conv.last_message;
        const preview   = last ? (last.message_type !== 'text' ? `📎 ${last.message_type}` : (last.text || '')) : 'Say hello 👋';
        const unread    = conv.unread_count || 0;
        const isActive  = conv.id == _dm.activeConvId;
        const timeStr   = last ? _dmRelativeTime(last.timestamp) : '';
        const name      = other?.display_name || other?.username || 'Unknown';
        const initials  = _dmInitials(name);
        // Serializer returns profile_image_url; available_users_view returns profile_image
        const avatarSrc = other?.profile_image_url || other?.profile_image || null;
        const avatarHtml = avatarSrc
            ? `<img src="${_escHtml(avatarSrc)}" alt="">`
            : `<span style="font-size:14px;font-weight:700;letter-spacing:-0.5px;">${initials}</span>`;

        return `
        <div class="dm-conv-item ${isActive ? 'active' : ''}" onclick="dmOpenConversation(${conv.id})" data-conv-id="${conv.id}">
            <div class="dm-conv-avatar">
                ${avatarHtml}
            </div>
            <div class="dm-conv-body">
                <div class="dm-conv-name">${_escHtml(name)}</div>
                <div class="dm-conv-preview ${unread ? 'unread' : ''}">${_escHtml(preview.slice(0, 60))}</div>
            </div>
            <div class="dm-conv-meta">
                ${timeStr ? `<span class="dm-conv-time">${timeStr}</span>` : ''}
                ${unread ? `<span class="dm-unread-badge">${unread > 9 ? '9+' : unread}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ── Open conversation ─────────────────────────────────────────────────────────
async function dmOpenConversation(convId) {
    _dm.activeConvId = convId;

    // Highlight active item in sidebar
    document.querySelectorAll('.dm-conv-item').forEach(el => {
        el.classList.toggle('active', el.dataset.convId == convId);
    });

    // Find conversation meta
    const conv = _dm.conversations.find(c => c.id == convId);
    const other = conv ? _dmOtherParticipant(conv, _dmCurrentUserId()) : null;
    const name = other?.display_name || other?.username || 'Chat';
    const initials = _dmInitials(name);

    // Update chat header
    const nameEl   = document.getElementById('dmChatName');
    const avatarEl = document.getElementById('dmChatAvatar');
    if (nameEl)   nameEl.textContent = name;
    // Serializer returns profile_image_url; fall back to profile_image for other sources
    const chatAvatarSrc = other?.profile_image_url || other?.profile_image || null;
    if (avatarEl) avatarEl.innerHTML = chatAvatarSrc
        ? `<img src="${_escHtml(chatAvatarSrc)}" alt="">`
        : `<span style="font-size:15px;font-weight:700;letter-spacing:-0.5px;">${initials}</span>`;

    // Store other user id for profile link
    if (other?.id) avatarEl?.setAttribute('data-user-id', other.id);

    // Show chat inner, hide welcome
    const welcome = document.getElementById('dmWelcome');
    const inner   = document.getElementById('dmChatInner');
    if (welcome) welcome.style.display = 'none';
    if (inner)   inner.style.display   = 'flex';

    // Mobile — slide sidebar off, bring chat in
    document.getElementById('dmSidebar')?.classList.add('hidden');
    document.getElementById('dmChatArea')?.classList.add('visible');

    // Load messages
    await dmLoadMessages(convId);

    // Poll for new messages every 3 s while this conv is open
    clearInterval(_dm.msgPollInterval);
    _dm.msgPollInterval = setInterval(() => dmLoadMessages(convId, true), 3000);
}

// ── Load / refresh messages ───────────────────────────────────────────────────
async function dmLoadMessages(convId, silent = false) {
    const container = document.getElementById('dmMessages');
    if (!container) return;

    if (!silent) {
        container.innerHTML = '<div class="dm-msgs-loading"><div class="dm-spinner"></div></div>';
    }

    try {
        const data = await DM_API.messages(convId);
        const msgs = Array.isArray(data) ? data : (data.results || []);
        const currentUserId = _dmCurrentUserId();
        const wasScrolledToBottom = _dmIsScrolledToBottom(container);

        container.innerHTML = dmRenderMessages(msgs, currentUserId);

        // Auto-scroll only if already at bottom (don't hijack mid-scroll)
        if (!silent || wasScrolledToBottom) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (e) {
        if (!silent) {
            container.innerHTML = '<div class="dm-empty-state">Could not load messages.</div>';
        }
    }
}

function dmRenderMessages(msgs, currentUserId) {
    if (!msgs.length) {
        return '<div class="dm-empty-state">No messages yet. Say hello!</div>';
    }

    let html       = '';
    let lastDate   = '';

    msgs.forEach(msg => {
        const isMine    = String(msg.sender?.id || msg.sender) === String(currentUserId);
        const side      = isMine ? 'mine' : 'theirs';
        const timeStr   = _dmFormatTime(msg.timestamp);
        const dateStr   = _dmFormatDate(msg.timestamp);

        // Date separator
        if (dateStr !== lastDate) {
            html += `<div class="dm-date-sep">${dateStr}</div>`;
            lastDate = dateStr;
        }

        // Avatar (only for other person)
        const avatarHtml = !isMine
            ? `<div class="dm-msg-avatar"><i class="fas fa-circle-user"></i></div>`
            : '';

        // Bubble content
        let bubbleContent = '';
        if (msg.message_type === 'text' || !msg.message_type) {
            bubbleContent = `<span>${_escHtml(msg.text || '')}</span>`;
        } else if (msg.message_type === 'image') {
            const src = msg.media_url || msg.media_file;
            bubbleContent = src ? `<img src="${_escHtml(src)}" alt="image" onclick="window.open(this.src,'_blank')">` : '[image]';
        } else if (msg.message_type === 'video') {
            const src = msg.media_url || msg.media_file;
            bubbleContent = src ? `<video src="${_escHtml(src)}" controls></video>` : '[video]';
        } else if (msg.message_type === 'audio') {
            const src = msg.media_url || msg.media_file;
            bubbleContent = src ? `<audio src="${_escHtml(src)}" controls></audio>` : '[audio]';
        } else {
            bubbleContent = `<span>📎 ${_escHtml(msg.message_type)}</span>`;
        }

        html += `
        <div class="dm-msg-row ${side}">
            ${avatarHtml}
            <div>
                <div class="dm-bubble">${bubbleContent}</div>
                <div class="dm-msg-time">${timeStr}</div>
            </div>
        </div>`;
    });

    return html;
}

// ── Close chat (mobile back) ──────────────────────────────────────────────────
function dmCloseChat() {
    clearInterval(_dm.msgPollInterval);
    _dm.activeConvId = null;
    document.getElementById('dmSidebar')?.classList.remove('hidden');
    document.getElementById('dmChatArea')?.classList.remove('visible');
    const welcome = document.getElementById('dmWelcome');
    const inner   = document.getElementById('dmChatInner');
    if (welcome) welcome.style.display = '';
    if (inner)   inner.style.display   = 'none';
}

// ── Send message ──────────────────────────────────────────────────────────────
async function dmSendMessage(event) {
    event.preventDefault();
    if (!_dm.activeConvId) return;

    const input = document.getElementById('dmTextInput');
    const text  = (input?.value || '').trim();

    if (!text && !_dm.pendingMedia) return;

    const sendBtn = document.querySelector('.dm-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    try {
        if (_dm.pendingMedia) {
            const fd = new FormData();
            fd.append('message_type', _dm.pendingMedia.type);
            fd.append('media_file',   _dm.pendingMedia.file);
            if (text) fd.append('text', text);
            await DM_API.sendMessage(_dm.activeConvId, fd);
            dmRemoveMedia();
        } else {
            await DM_API.sendMessage(_dm.activeConvId, { message_type: 'text', text });
        }

        if (input) input.value = '';
        await dmLoadMessages(_dm.activeConvId);
        dmRefreshConversations();
    } catch (e) {
        console.error('dmSendMessage:', e);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
}

// ── Media attachment ──────────────────────────────────────────────────────────
function dmHandleMedia(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const type = file.type.startsWith('image/') ? 'image'
               : file.type.startsWith('video/') ? 'video'
               : file.type.startsWith('audio/') ? 'audio'
               : 'file';

    const reader = new FileReader();
    reader.onload = e => {
        _dm.pendingMedia = { file, type, dataUrl: e.target.result };
        const preview = document.getElementById('dmMediaPreview');
        const thumb   = document.getElementById('dmMediaThumb');
        if (preview) preview.style.display = 'flex';
        if (thumb)   thumb.src = type === 'image' ? e.target.result
                                                   : 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be selected again
    event.target.value = '';
}

function dmRemoveMedia() {
    _dm.pendingMedia = null;
    const preview = document.getElementById('dmMediaPreview');
    if (preview) preview.style.display = 'none';
}

// ── New chat modal ────────────────────────────────────────────────────────────
function dmOpenNewChat() {
    const modal = document.getElementById('dmNewChatModal');
    if (modal) modal.style.display = 'flex';
    const input = document.getElementById('dmUserSearch');
    if (input) { input.value = ''; input.focus(); }
    // Load suggested players immediately — no typing required
    _dmLoadSuggestedUsers();
}

function dmCloseNewChat() {
    const modal = document.getElementById('dmNewChatModal');
    if (modal) modal.style.display = 'none';
}

// Load the full suggested list (no query) when the modal first opens
async function _dmLoadSuggestedUsers() {
    const results = document.getElementById('dmUserResults');
    if (!results) return;
    results.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';

    // Ensure apiService has the latest token (it may have been set after construction)
    if (!apiService.token) {
        apiService.token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken') || null;
    }

    try {
        const users = await DM_API.availableUsers('');
        _dmRenderUserResults(users);
    } catch (e) {
        console.error('dmLoadSuggestedUsers:', e);
        results.innerHTML = '<p class="dm-hint">Could not load users. Try searching.</p>';
    }
}

async function dmSearchUsers(query) {
    clearTimeout(_dm.searchDebounce);
    const results = document.getElementById('dmUserResults');

    if (!query.trim()) {
        // Empty search — reload the full suggested list
        _dmLoadSuggestedUsers();
        return;
    }

    // Ensure apiService has the latest token
    if (!apiService.token) {
        apiService.token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken') || null;
    }

    _dm.searchDebounce = setTimeout(async () => {
        if (results) results.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';
        try {
            const users = await DM_API.availableUsers(query);
            _dmRenderUserResults(users);
        } catch (e) {
            if (results) results.innerHTML = '<p class="dm-hint">Search failed. Try again.</p>';
        }
    }, 300);
}

function _dmRenderUserResults(users) {
    const results = document.getElementById('dmUserResults');
    if (!results) return;

    if (!users.length) {
        results.innerHTML = '<p class="dm-hint">No players found.</p>';
        return;
    }

    const currentUserId = _dmCurrentUserId();

    results.innerHTML = users.map(u => {
        const name     = u.display_name || u.username;
        const initials = _dmInitials(name);
        // available_users_view returns 'profile_image'; serializer returns 'profile_image_url'
        const userAvatarSrc = u.profile_image || u.profile_image_url || null;
        const avatarHtml = userAvatarSrc
            ? `<img src="${_escHtml(userAvatarSrc)}" alt="">`
            : `<span style="font-size:14px;font-weight:700;">${initials}</span>`;
        const isFollowing = u.is_following;
        const isActive    = u.is_active;

        return `
        <div class="dm-user-result-item" onclick="dmStartConversation(${u.id})">
            <div class="dm-user-result-avatar" style="position:relative;">
                ${avatarHtml}
                ${isActive ? `<span style="
                    position:absolute;bottom:1px;right:1px;
                    width:10px;height:10px;background:#22c55e;
                    border-radius:50%;border:2px solid #fff;">
                </span>` : ''}
            </div>
            <div class="dm-user-result-info">
                <div class="dm-user-result-name">
                    ${_escHtml(name)}
                    ${isFollowing ? `<span style="font-size:10px;color:var(--artx-primary,#556b2f);font-weight:600;margin-left:5px;">Following</span>` : ''}
                </div>
                <div class="dm-user-result-tier">
                    ${_escHtml(u.access_tier || 'Bronze')} · ${(u.prestige_points || 0).toLocaleString()} pts
                </div>
            </div>
            <button class="dm-user-result-action"
                    onclick="event.stopPropagation();dmStartConversation(${u.id})">
                Message
            </button>
        </div>`;
    }).join('');
}

async function dmStartConversation(userId) {
    dmCloseNewChat();
    try {
        const conv = await DM_API.startConv(userId);
        // Refresh conversation list then open the new/existing conv
        await dmLoadConversations();
        if (conv?.id) dmOpenConversation(conv.id);
    } catch (e) {
        console.error('dmStartConversation:', e);
    }
}

// ── Client-side search filter ─────────────────────────────────────────────────
function dmFilterConversations(query) {
    const q = query.toLowerCase().trim();
    if (!q) { dmRenderConvList(_dm.conversations); return; }
    const currentUserId = _dmCurrentUserId();
    const filtered = _dm.conversations.filter(conv => {
        const other = _dmOtherParticipant(conv, currentUserId);
        const name  = (other?.username || '') + ' ' + (other?.display_name || '');
        return name.toLowerCase().includes(q);
    });
    dmRenderConvList(filtered);
}

// ── Unread badge on nav button ────────────────────────────────────────────────
function dmUpdateBadge() {
    let total = 0;
    _dm.conversations.forEach(c => { total += c.unread_count || 0; });
    const badge = document.getElementById('msgBadge');
    if (badge) {
        badge.textContent    = total > 9 ? '9+' : total;
        badge.style.display  = total > 0 ? '' : 'none';
    }
}

// ── Public entry point called by switchView() in app.js ──────────────────────
window.dmInit = dmInit;
window.dmStopPolling = dmStopPolling;

// Auto-init when the messenger section becomes visible (hook into switchView)
const _origSwitchView = typeof switchView === 'function' ? switchView : null;
if (typeof window !== 'undefined') {
    // Attach after DOM ready so app.js has already defined switchView
    document.addEventListener('DOMContentLoaded', () => {
        // Poll unread count globally every 30s (even when not in messenger view)
        setInterval(async () => {
            try {
                const d = await DM_API.unreadCount();
                const badge  = document.getElementById('msgBadge');
                const badge2 = document.getElementById('msgBadgeMobile');
                const n = d?.unread_count || 0;
                [badge, badge2].forEach(b => {
                    if (!b) return;
                    b.textContent   = n > 9 ? '9+' : n;
                    b.style.display = n > 0 ? '' : 'none';
                });
            } catch (_) {}
        }, 30000);

        // Deep-link: if page loaded with #messenger in hash, open the view
        if (window.location.hash.startsWith('#messenger')) {
            setTimeout(() => {
                if (typeof switchView === 'function') switchView('messenger');
            }, 400);
        }
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _dmCurrentUserId() {
    try {
        const raw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
        return raw ? JSON.parse(raw)?.id : null;
    } catch (_) { return null; }
}

function _dmOtherParticipant(conv, currentUserId) {
    if (!conv?.participants) return null;
    return conv.participants.find(p => String(p.id || p) !== String(currentUserId)) || null;
}

function _dmIsScrolledToBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function _dmRelativeTime(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)   return 'just now';
    if (m < 60)  return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h`;
    return `${Math.floor(h / 24)}d`;
}

function _dmFormatTime(isoStr) {
    if (!isoStr) return '';
    return new Date(isoStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function _dmFormatDate(isoStr) {
    if (!isoStr) return '';
    const d    = new Date(isoStr);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yest = new Date(today); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function _escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _dmInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function dmViewProfile() {
    const avatarEl = document.getElementById('dmChatAvatar');
    const userId   = avatarEl?.getAttribute('data-user-id');
    if (userId) window.location.href = `pages/user.html?id=${userId}`;
}

// Expose for use by other scripts (e.g. social-feed "Message" buttons)
window.dmStartConversation = dmStartConversation;
window.dmOpenNewChat       = dmOpenNewChat;
window.dmFilterConversations = dmFilterConversations;
window.dmSearchUsers       = dmSearchUsers;
window.dmCloseNewChat      = dmCloseNewChat;
window.dmOpenConversation  = dmOpenConversation;
window.dmCloseChat         = dmCloseChat;
window.dmSendMessage       = dmSendMessage;
window.dmHandleMedia       = dmHandleMedia;
window.dmRemoveMedia       = dmRemoveMedia;
window.dmViewProfile       = dmViewProfile;
