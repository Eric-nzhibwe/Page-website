/**
 * ARTX Firebase Messenger — Real-time Firestore listeners
 * =========================================================
 *
 * Voice note workflow (simplified & reliable):
 *   1. MediaRecorder captures audio via getUserMedia  (messenger.js)
 *   2. User presses send → dmSendMessage intercept here
 *   3. Audio Blob is POSTed directly to Django REST API (multipart/form-data)
 *   4. Django saves the file, runs the post_save signal
 *   5. Signal calls mirror_message() → writes to Firestore with the media_url
 *   6. Recipient's onSnapshot fires → message appears in real time
 *   7. Sender sees optimistic bubble immediately while Django saves in background
 *
 * Why NOT Firebase Storage:
 *   Firebase Storage uploads from the browser require the user to be
 *   authenticated with Firebase Auth.  This app uses Django token auth, so
 *   anonymous Storage uploads are blocked by default Firebase Security Rules.
 *   Django media storage is simpler, already works, and the Firestore mirror
 *   (post_save signal) delivers the message to the recipient in real time anyway.
 *
 * Text / image workflow (unchanged):
 *   Django REST → post_save signal → Firestore mirror → onSnapshot
 *
 * Falls back to REST polling when Firebase is not configured.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const _fb = {
    app:            null,
    db:             null,
    ready:          false,
    convListUnsub:  null,
    msgUnsub:       null,
    activeConvId:   null,
    config:         null,
};

const CONV_COLL = 'messenger_conversations';

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function fbMessengerInit() {
    if (_fb.ready) {
        _fbAttachConvListListener();
        return;
    }

    try {
        const config = await _fbFetchConfig();
        if (!config || !config.projectId) {
            console.info('Firebase not configured — messenger will use REST polling.');
            return;
        }
        _fb.config = config;

        await _fbLoadSDK();

        const firebase = window.firebase;
        if (!firebase) throw new Error('Firebase SDK not loaded');

        if (!firebase.apps?.length) {
            _fb.app = firebase.initializeApp(config);
        } else {
            _fb.app = firebase.apps[0];
        }

        _fb.db    = firebase.firestore(_fb.app);
        _fb.ready = true;

        _fbAttachConvListListener();

        console.info('Firebase Messenger: real-time Firestore listeners active.');
    } catch (err) {
        console.warn('Firebase Messenger init failed — falling back to polling.', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Config fetch
// ─────────────────────────────────────────────────────────────────────────────

async function _fbFetchConfig() {
    try {
        return await apiService.get('/messenger/firebase-config/');
    } catch (_) {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Dynamic SDK load  (Firestore only — no Storage needed)
// ─────────────────────────────────────────────────────────────────────────────

function _fbLoadSDK() {
    return new Promise((resolve, reject) => {
        if (window.firebase && window.firebase.firestore) { resolve(); return; }

        const needed = [];
        if (!window.firebase || !window.firebase.app) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
        }
        if (!window.firebase || !window.firebase.firestore) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js');
        }

        if (!needed.length) { resolve(); return; }

        const toLoad = needed.filter(src => !document.querySelector(`script[src="${src}"]`));
        if (!toLoad.length) { setTimeout(resolve, 0); return; }

        let loaded = 0;
        toLoad.forEach(src => {
            const el   = document.createElement('script');
            el.src     = src;
            el.async   = false;
            el.onload  = () => { if (++loaded === toLoad.length) resolve(); };
            el.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(el);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Voice note send — direct Django upload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a voice note by uploading directly to Django.
 *
 * Steps:
 *   1. Show a "Sending…" indicator in the preview strip
 *   2. POST the audio file to Django via multipart/form-data
 *   3. Django saves it, post_save signal mirrors it to Firestore
 *   4. The existing onSnapshot listener renders it for both sender and recipient
 *   5. Clean up compose bar
 *
 * Returns true if handled, false if an error occurred (caller falls back).
 */
async function _fbSendVoiceMessage(convId, pendingMedia) {
    const { file, duration } = pendingMedia;

    // Show a sending indicator
    const strip = document.getElementById('dmComposePreview');
    if (strip) {
        strip.innerHTML = `
            <div class="dm-voice-preview-inner" id="fbSendingIndicator">
                <i class="fas fa-paper-plane" style="color:#556b2f;font-size:16px;
                   animation:dmSpin 1s linear infinite;"></i>
                <span style="font-size:13px;font-weight:600;color:#556b2f;">Sending…</span>
            </div>`;
        strip.classList.add('visible');
    }

    try {
        const token = localStorage.getItem('djangoAuthToken')
                   || localStorage.getItem('authToken')
                   || (typeof apiService !== 'undefined' ? apiService.token : null);

        if (!token) throw new Error('Not authenticated');

        const apiBase = (window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1')
            ? 'http://localhost:8000/api'
            : `${window.location.origin}/api`;

        const fd = new FormData();
        fd.append('message_type', 'audio');
        fd.append('media_file', file, file.name || `voice-${Date.now()}.webm`);
        if (duration) fd.append('duration', String(Math.round(duration)));

        const res = await fetch(
            `${apiBase}/messenger/conversations/${convId}/send_message/`,
            {
                method:  'POST',
                headers: { Authorization: `Token ${token}` },
                body:    fd,
            }
        );

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status}`);
        }

        // Success — clean up the compose bar
        if (typeof dmRemoveMedia === 'function') dmRemoveMedia();
        return true;

    } catch (err) {
        console.error('_fbSendVoiceMessage failed:', err.message);

        // Reset the preview strip back to the voice preview so the user can retry
        if (strip && typeof _dm !== 'undefined' && _dm.pendingMedia) {
            const dur = _dm.pendingMedia.duration
                ? ` — ${typeof _dmFmtDuration === 'function' ? _dmFmtDuration(_dm.pendingMedia.duration) : ''}`
                : '';
            strip.innerHTML = `
                <div class="dm-voice-preview-inner">
                    <i class="fas fa-microphone"></i>
                    <span>Voice message${dur}</span>
                </div>
                <button type="button" class="dm-preview-remove"
                        onclick="dmRemoveMedia()" title="Remove">&times;</button>`;
            strip.classList.add('visible');
        }

        if (typeof showToast === 'function') {
            showToast(`Could not send voice note: ${err.message}`, 'error');
        }
        return false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Conversation list listener
// ─────────────────────────────────────────────────────────────────────────────

function _fbAttachConvListListener() {
    if (!_fb.ready || !_fb.db) return;

    const currentUserId = _fbCurrentUserId();
    if (!currentUserId) return;

    if (_fb.convListUnsub) { _fb.convListUnsub(); _fb.convListUnsub = null; }

    _fb.convListUnsub = _fb.db
        .collection(CONV_COLL)
        .where('participant_ids', 'array-contains', String(currentUserId))
        .orderBy('updated_at', 'desc')
        .limit(50)
        .onSnapshot(
            snapshot => _fbHandleConvListUpdate(snapshot, currentUserId),
            err => console.warn('FB conv list listener error:', err.message)
        );
}

function _fbHandleConvListUpdate(snapshot, currentUserId) {
    const convs = [];
    snapshot.forEach(doc => convs.push(_fbFormatConv(doc.data(), currentUserId)));

    if (typeof _dm !== 'undefined') {
        _dm.conversations = convs;
        if (typeof dmRenderConvList === 'function') dmRenderConvList(convs);
        if (typeof dmUpdateBadge    === 'function') dmUpdateBadge();
    }

    const totalUnread = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    ['msgBadge', 'msgBadgeMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent   = totalUnread > 9 ? '9+' : String(totalUnread);
        el.style.display = totalUnread > 0 ? '' : 'none';
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Message listener
// ─────────────────────────────────────────────────────────────────────────────

function fbAttachMessageListener(convId) {
    if (!_fb.ready || !_fb.db) return false;

    const currentUserId = _fbCurrentUserId();

    if (_fb.msgUnsub) { _fb.msgUnsub(); _fb.msgUnsub = null; }
    _fb.activeConvId = convId;

    _fb.msgUnsub = _fb.db
        .collection(CONV_COLL)
        .doc(String(convId))
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limit(100)
        .onSnapshot(
            snapshot => _fbHandleMessageUpdate(snapshot, currentUserId),
            err => console.warn('FB message listener error:', err.message)
        );

    return true;
}

function _fbHandleMessageUpdate(snapshot, currentUserId) {
    const container = document.getElementById('dmMessages');
    if (!container) return;

    const msgs = [];
    snapshot.forEach(doc => {
        const d  = doc.data();
        // Normalise Firestore Timestamp → ISO string
        const ts = d.timestamp?.toDate?.()?.toISOString?.()
                ?? (d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000).toISOString() : null)
                ?? d.timestamp
                ?? null;
        msgs.push({ ...d, timestamp: ts });
    });

    const wasAtBottom = _fbIsScrolledToBottom(container);

    if (typeof dmRenderMessages === 'function') {
        container.innerHTML = dmRenderMessages(msgs, currentUserId);
    } else {
        container.innerHTML = msgs.map(m => {
            const mine = String(m.sender_id) === String(currentUserId);
            return `<div class="dm-msg-row ${mine ? 'mine' : 'theirs'}">
                <div class="dm-bubble">${_fbEscape(m.text || '[media]')}</div>
            </div>`;
        }).join('');
    }

    if (wasAtBottom) container.scrollTop = container.scrollHeight;

    // Mark as read (best-effort)
    if (_fb.activeConvId) {
        _fbMarkRead(_fb.activeConvId).catch(() => {});
    }
}

async function _fbMarkRead(convId) {
    try {
        await apiService.post(`/messenger/conversations/${convId}/mark-read/`, {});
    } catch (_) { /* non-critical */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Detach all listeners
// ─────────────────────────────────────────────────────────────────────────────

function fbMessengerDetach() {
    if (_fb.convListUnsub) { _fb.convListUnsub(); _fb.convListUnsub = null; }
    if (_fb.msgUnsub)      { _fb.msgUnsub();      _fb.msgUnsub      = null; }
    _fb.activeConvId = null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Patch messenger.js functions
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const _origDmInit        = window.dmInit;
    const _origDmStopPolling = window.dmStopPolling;
    const _origDmOpenConv    = window.dmOpenConversation;
    const _origDmCloseChat   = window.dmCloseChat;
    const _origDmSendMessage = window.dmSendMessage;

    // ── Wrap dmInit ──────────────────────────────────────────────────────────
    window.dmInit = async function () {
        if (_origDmInit) await _origDmInit();
        await fbMessengerInit();

        // Kill REST conv-list polling — Firestore listener owns it now
        if (_fb.ready && typeof _dm !== 'undefined' && _dm.pollInterval) {
            clearInterval(_dm.pollInterval);
            _dm.pollInterval = null;
        }
    };

    // ── Wrap dmStopPolling ───────────────────────────────────────────────────
    window.dmStopPolling = function () {
        if (_origDmStopPolling) _origDmStopPolling();
        fbMessengerDetach();
    };

    // ── Wrap dmOpenConversation ──────────────────────────────────────────────
    window.dmOpenConversation = async function (convId) {
        if (_origDmOpenConv) await _origDmOpenConv(convId);

        if (_fb.ready) {
            // Kill REST message poll — Firestore listener takes over
            if (typeof _dm !== 'undefined' && _dm.msgPollInterval) {
                clearInterval(_dm.msgPollInterval);
                _dm.msgPollInterval = null;
            }
            fbAttachMessageListener(convId);
        }
    };

    // ── Wrap dmCloseChat ─────────────────────────────────────────────────────
    window.dmCloseChat = function () {
        if (_origDmCloseChat) _origDmCloseChat();
        if (_fb.msgUnsub) { _fb.msgUnsub(); _fb.msgUnsub = null; }
        _fb.activeConvId = null;
    };

    // ── Wrap dmSendMessage — intercept audio sends ────────────────────────────
    window.dmSendMessage = async function (event) {
        event.preventDefault();

        const convId      = typeof _dm !== 'undefined' ? _dm.activeConvId  : null;
        const pendingMedia = typeof _dm !== 'undefined' ? _dm.pendingMedia : null;

        if (!convId) return;

        // Intercept audio sends — route through Django (not Firebase Storage)
        if (pendingMedia && pendingMedia.type === 'audio' &&
            pendingMedia.file && pendingMedia.file.size > 0) {

            const sendBtn = document.querySelector('.dm-send-btn');
            if (sendBtn) sendBtn.disabled = true;

            try {
                const handled = await _fbSendVoiceMessage(convId, pendingMedia);
                if (handled) return;
                // Fall through to original send on failure
            } catch (err) {
                console.error('Voice send interceptor error:', err.message);
                if (typeof showToast === 'function') {
                    showToast('Voice send failed — retrying…', 'error');
                }
            } finally {
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        // All other message types (text, image, video, file)
        if (_origDmSendMessage) await _origDmSendMessage(event);
    };
});

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _fbCurrentUserId() {
    try {
        const raw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
        return raw ? JSON.parse(raw)?.id : null;
    } catch (_) { return null; }
}

function _fbIsScrolledToBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function _fbEscape(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fbFormatConv(d, currentUserId) {
    const uid    = String(currentUserId);
    const unread = (d.unread_counts || {})[uid] || 0;
    const last   = d.last_message;
    const pData  = d.participant_data || {};

    return {
        id:           d.id,
        participants: (d.participant_ids || []).map(id => ({
            id:            id,
            username:      (pData[id] || {}).username     || '',
            display_name:  (pData[id] || {}).display_name || '',
            profile_image: (pData[id] || {}).avatar       || null,
            access_tier:   (pData[id] || {}).access_tier  || 'Bronze',
        })),
        last_message: last ? {
            id:           last.id,
            message_type: last.message_type,
            text:         last.text,
            sender_id:    last.sender_id,
            timestamp:    last.timestamp?.toDate?.()?.toISOString?.() || last.timestamp,
            read:         last.read,
        } : null,
        unread_count: unread,
        updated_at:   d.updated_at?.toDate?.()?.toISOString?.() || d.updated_at,
    };
}

// Public API
window.fbMessengerInit         = fbMessengerInit;
window.fbMessengerDetach       = fbMessengerDetach;
window.fbAttachMessageListener = fbAttachMessageListener;
