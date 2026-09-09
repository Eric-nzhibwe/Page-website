/**
 * ARTX Firebase Messenger — Real-time Firestore listener
 * ========================================================
 * Replaces the polling approach in messenger.js with live
 * Firestore subscriptions so messages appear instantly.
 *
 * Architecture:
 *   Backend (Django) writes to PostgreSQL → post_save signal mirrors
 *   to Firestore → this script receives the Firestore snapshot update
 *   → updates the UI without any polling.
 *
 * Falls back to the existing REST polling (messenger.js) when:
 *   • Firebase SDK fails to load
 *   • Backend returns empty firebase config (Firebase not configured)
 *   • Any initialisation error
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const _fb = {
    app:             null,
    db:              null,
    ready:           false,
    convListUnsub:   null,   // unsubscribe fn for conversation list listener
    msgUnsub:        null,   // unsubscribe fn for active message listener
    activeConvId:    null,
};

const CONV_COLL = 'messenger_conversations';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

/**
 * Called once when the messenger view opens.
 * Fetches Firebase config from Django, loads the Firebase SDK,
 * then attaches real-time listeners.
 */
async function fbMessengerInit() {
    if (_fb.ready) {
        // Already initialised — just re-attach the conv list listener
        _fbAttachConvListListener();
        return;
    }

    try {
        // 1. Fetch public Firebase config from Django
        const config = await _fbFetchConfig();
        if (!config || !config.projectId) {
            console.info('Firebase not configured — messenger will use REST polling.');
            return;
        }

        // 2. Dynamically load Firebase JS SDK (v9 compat mode)
        await _fbLoadSDK();

        // 3. Initialise the app (idempotent)
        const firebase = window.firebase;
        if (!firebase) throw new Error('Firebase SDK not loaded');

        if (!firebase.apps?.length) {
            _fb.app = firebase.initializeApp(config);
        } else {
            _fb.app = firebase.apps[0];
        }

        _fb.db    = firebase.firestore(_fb.app);
        _fb.ready = true;

        // 4. Attach the conversation list listener
        _fbAttachConvListListener();

        console.info('Firebase Messenger: real-time listeners active.');
    } catch (err) {
        console.warn('Firebase Messenger init failed — falling back to polling.', err);
        // messenger.js polling is already running — nothing to do
    }
}

// ── Config fetch ──────────────────────────────────────────────────────────────

async function _fbFetchConfig() {
    try {
        return await apiService.get('/messenger/firebase-config/');
    } catch (e) {
        return null;
    }
}

// ── Dynamic SDK load ──────────────────────────────────────────────────────────

function _fbLoadSDK() {
    return new Promise((resolve, reject) => {
        if (window.firebase && window.firebase.firestore) {
            resolve();
            return;
        }
        // Load Firebase compat SDK (v9 compat — same API as v8)
        const scripts = [
            'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
            'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js',
        ];
        let loaded = 0;
        scripts.forEach(src => {
            const el   = document.createElement('script');
            el.src     = src;
            el.async   = false;
            el.onload  = () => { if (++loaded === scripts.length) resolve(); };
            el.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(el);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Conversation list listener
// ─────────────────────────────────────────────────────────────────────────────

function _fbAttachConvListListener() {
    if (!_fb.ready || !_fb.db) return;

    const currentUserId = _fbCurrentUserId();
    if (!currentUserId) return;

    // Detach previous listener if any
    if (_fb.convListUnsub) {
        _fb.convListUnsub();
        _fb.convListUnsub = null;
    }

    _fb.convListUnsub = _fb.db
        .collection(CONV_COLL)
        .where('participant_ids', 'array-contains', String(currentUserId))
        .orderBy('updated_at', 'desc')
        .limit(50)
        .onSnapshot(
            snapshot => _fbHandleConvListUpdate(snapshot, currentUserId),
            err => console.warn('FB conv list listener error:', err)
        );
}

function _fbHandleConvListUpdate(snapshot, currentUserId) {
    const convs = [];

    snapshot.forEach(doc => {
        const d = doc.data();
        convs.push(_fbFormatConv(d, currentUserId));
    });

    // Push into the existing messenger.js state + re-render
    if (typeof _dm !== 'undefined') {
        _dm.conversations = convs;
        if (typeof dmRenderConvList === 'function') dmRenderConvList(convs);
        if (typeof dmUpdateBadge    === 'function') dmUpdateBadge();
    }

    // Update the header unread badge counts
    const totalUnread = convs.reduce((sum, c) => sum + (c.unread_count || 0), 0);
    ['msgBadge', 'msgBadgeMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent   = totalUnread > 9 ? '9+' : totalUnread;
            el.style.display = totalUnread > 0 ? '' : 'none';
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Message listener for the active conversation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attach a Firestore listener to the messages sub-collection of a conversation.
 * Replaces the setInterval polling in messenger.js when Firebase is available.
 *
 * Called by the patched dmOpenConversation() below.
 */
function fbAttachMessageListener(convId) {
    if (!_fb.ready || !_fb.db) return false;

    const currentUserId = _fbCurrentUserId();

    // Detach previous listener
    if (_fb.msgUnsub) {
        _fb.msgUnsub();
        _fb.msgUnsub = null;
    }
    _fb.activeConvId = convId;

    _fb.msgUnsub = _fb.db
        .collection(CONV_COLL)
        .doc(String(convId))
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limit(100)
        .onSnapshot(
            snapshot => _fbHandleMessageUpdate(snapshot, currentUserId),
            err => console.warn('FB message listener error:', err)
        );

    return true; // caller knows Firebase is handling it
}

function _fbHandleMessageUpdate(snapshot, currentUserId) {
    const container = document.getElementById('dmMessages');
    if (!container) return;

    const msgs = [];
    snapshot.forEach(doc => msgs.push(doc.data()));

    const wasAtBottom = _fbIsScrolledToBottom(container);

    // Re-use the existing render function from messenger.js
    if (typeof dmRenderMessages === 'function') {
        container.innerHTML = dmRenderMessages(msgs, currentUserId);
    } else {
        // Minimal fallback if dmRenderMessages isn't available
        container.innerHTML = msgs.map(m => {
            const mine = String(m.sender_id) === String(currentUserId);
            return `<div class="dm-msg-row ${mine ? 'mine' : 'theirs'}">
                <div class="dm-bubble">${_fbEscape(m.text || '[media]')}</div>
            </div>`;
        }).join('');
    }

    if (wasAtBottom) container.scrollTop = container.scrollHeight;

    // Mark messages as read via the backend (best-effort)
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
//  Detach all listeners (called when leaving messenger view)
// ─────────────────────────────────────────────────────────────────────────────

function fbMessengerDetach() {
    if (_fb.convListUnsub) { _fb.convListUnsub(); _fb.convListUnsub = null; }
    if (_fb.msgUnsub)      { _fb.msgUnsub();      _fb.msgUnsub      = null; }
    _fb.activeConvId = null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Patch messenger.js functions to use Firestore when available
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Override dmInit from messenger.js to also kick off Firebase.
 * We wrap the original rather than replace it so REST polling still
 * runs as a fallback when Firebase isn't available.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Wait for messenger.js to define dmInit, then wrap it
    const _origDmInit        = window.dmInit;
    const _origDmStopPolling = window.dmStopPolling;
    const _origDmOpenConv    = window.dmOpenConversation;
    const _origDmCloseChat   = window.dmCloseChat;

    window.dmInit = async function () {
        // Run original init (loads REST conversations + starts polling)
        if (_origDmInit) await _origDmInit();

        // Then layer Firebase real-time listeners on top
        await fbMessengerInit();

        // If Firebase listeners are running, kill the REST polling — no need
        if (_fb.ready && typeof clearInterval !== 'undefined' && _dm?.pollInterval) {
            clearInterval(_dm.pollInterval);
            _dm.pollInterval = null;
        }
    };

    window.dmStopPolling = function () {
        if (_origDmStopPolling) _origDmStopPolling();
        fbMessengerDetach();
    };

    // When a conversation is opened, switch to Firestore message listener
    window.dmOpenConversation = async function (convId) {
        if (_origDmOpenConv) await _origDmOpenConv(convId);

        if (_fb.ready) {
            // Kill the REST message poll if it's running
            if (_dm?.msgPollInterval) {
                clearInterval(_dm.msgPollInterval);
                _dm.msgPollInterval = null;
            }
            // Attach Firestore listener for this conversation's messages
            fbAttachMessageListener(convId);
        }
    };

    window.dmCloseChat = function () {
        if (_origDmCloseChat) _origDmCloseChat();
        // Detach message listener but keep conv list listener running
        if (_fb.msgUnsub) {
            _fb.msgUnsub();
            _fb.msgUnsub = null;
        }
        _fb.activeConvId = null;
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
    const uid       = String(currentUserId);
    const unread    = (d.unread_counts || {})[uid] || 0;
    const last      = d.last_message;
    const pData     = d.participant_data || {};
    const otherUid  = (d.participant_ids || []).find(id => id !== uid);
    const otherData = otherUid ? (pData[otherUid] || {}) : {};

    return {
        id:           d.id,
        participants: (d.participant_ids || []).map(id => ({
            id:            id,
            username:      (pData[id] || {}).username || '',
            display_name:  (pData[id] || {}).display_name || '',
            profile_image: (pData[id] || {}).avatar    || null,
            access_tier:   (pData[id] || {}).access_tier || 'Bronze',
        })),
        last_message:  last ? {
            id:           last.id,
            message_type: last.message_type,
            text:         last.text,
            sender_id:    last.sender_id,
            timestamp:    last.timestamp?.toDate?.()?.toISOString?.() || last.timestamp,
            read:         last.read,
        } : null,
        unread_count:  unread,
        updated_at:    d.updated_at?.toDate?.()?.toISOString?.() || d.updated_at,
    };
}

// Expose for external use
window.fbMessengerInit   = fbMessengerInit;
window.fbMessengerDetach = fbMessengerDetach;
window.fbAttachMessageListener = fbAttachMessageListener;
