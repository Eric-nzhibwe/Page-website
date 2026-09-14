/**
 * ARTX Firebase Real-time Service
 * =================================
 * Replaces WebSocket / polling for notifications and messenger badge updates
 * with Firestore onSnapshot listeners so UI updates happen instantly.
 *
 * What this module owns
 * ─────────────────────
 *  • Bell badge + notification dropdown  → Firestore `notifications` collection
 *  • Messenger unread badge              → Firestore `messenger_conversations` collection
 *    (the full message UI is handled by firebase-messenger.js on the messenger page)
 *
 * Fallback behaviour
 * ──────────────────
 *  If Firebase is not configured (no storageBucket / projectId in the backend
 *  response), the module exits silently.  The existing WebSocket + polling code
 *  in realtime-updates.js continues to work unchanged as a fallback.
 *
 * Initialisation
 * ──────────────
 *  Called automatically on DOMContentLoaded.
 *  Also exported as window.fbRealtimeInit() so other scripts can call it after
 *  a login event.
 *
 * Firestore collections used (read-only from the client)
 * ───────────────────────────────────────────────────────
 *  notifications/
 *    recipient_id, notif_type, title, message, actor_display,
 *    actor_avatar, link, is_read, created_at
 *
 *  messenger_conversations/
 *    participant_ids[], unread_counts{}, last_message{}, updated_at
 */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────
const _fbRT = {
    app:            null,
    db:             null,
    ready:          false,
    config:         null,

    // Unsubscribe handles
    notifUnsub:     null,   // notifications listener
    convListUnsub:  null,   // messenger conv-list listener (badge only)

    // Dedup
    seenNotifIds:   new Set(),
    initialLoad:    true,   // suppress toasts for pre-existing notifications on first load
};

const NOTIF_COLL = 'notifications';
const CONV_COLL  = 'messenger_conversations';


// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main entry point.  Loads Firebase SDK, attaches Firestore listeners.
 * Safe to call multiple times — idempotent after first successful init.
 */
async function fbRealtimeInit() {
    if (_fbRT.ready) {
        // Already initialised — re-attach listeners (e.g. after login)
        _fbRTAttachAll();
        return;
    }

    try {
        // 1. Fetch Firebase config from Django
        const config = await _fbRTFetchConfig();
        if (!config || !config.projectId) {
            // Firebase not configured on this server — silent fallback
            return;
        }
        _fbRT.config = config;

        // 2. Load Firebase JS SDK (app + firestore compat only — no auth/storage)
        await _fbRTLoadSDK(config);

        // 3. Initialise / reuse app
        const firebase = window.firebase;
        if (!firebase) throw new Error('Firebase SDK unavailable');

        if (!firebase.apps || !firebase.apps.length) {
            _fbRT.app = firebase.initializeApp(config);
        } else {
            _fbRT.app = firebase.apps[0];
        }

        _fbRT.db    = firebase.firestore(_fbRT.app);
        _fbRT.ready = true;

        // 4. Attach all listeners
        _fbRTAttachAll();

        console.info('[ARTX] Firebase real-time listeners active.');
    } catch (err) {
        console.warn('[ARTX] Firebase real-time init failed — using polling fallback.', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Attach / detach all listeners
// ─────────────────────────────────────────────────────────────────────────────

function _fbRTAttachAll() {
    const uid = _fbRTCurrentUserId();
    if (!uid) return;

    _fbRTAttachNotifListener(uid);
    _fbRTAttachConvBadgeListener(uid);
}

function fbRealtimeDetach() {
    if (_fbRT.notifUnsub)    { _fbRT.notifUnsub();    _fbRT.notifUnsub    = null; }
    if (_fbRT.convListUnsub) { _fbRT.convListUnsub(); _fbRT.convListUnsub = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Notifications listener
// ─────────────────────────────────────────────────────────────────────────────

function _fbRTAttachNotifListener(userId) {
    if (!_fbRT.ready || !_fbRT.db) return;

    // Detach any previous listener
    if (_fbRT.notifUnsub) { _fbRT.notifUnsub(); _fbRT.notifUnsub = null; }

    _fbRT.initialLoad = true;

    // Listen to the 30 most recent notifications for this user, newest first
    _fbRT.notifUnsub = _fbRT.db
        .collection(NOTIF_COLL)
        .where('recipient_id', '==', String(userId))
        .orderBy('created_at', 'desc')
        .limit(30)
        .onSnapshot(
            snapshot => _fbRTHandleNotifSnapshot(snapshot),
            err => console.warn('[ARTX] Notification listener error:', err.message)
        );
}

function _fbRTHandleNotifSnapshot(snapshot) {
    const notifications = [];
    let   unreadCount   = 0;

    snapshot.forEach(doc => {
        const d  = doc.data();
        const n  = _fbRTFormatNotif(doc.id, d);
        notifications.push(n);
        if (!d.is_read) unreadCount++;
    });

    // Update bell badge
    _fbRTUpdateBellBadge(unreadCount);

    if (_fbRT.initialLoad) {
        // First snapshot — seed dedup set, render dropdown if open, no toasts
        notifications.forEach(n => _fbRT.seenNotifIds.add(n.id));
        _fbRT.initialLoad = false;
        _fbRTRenderDropdown(notifications);
        return;
    }

    // Subsequent snapshots — find truly new notifications (added since last update)
    const newNotifs = notifications.filter(n => !_fbRT.seenNotifIds.has(n.id));
    newNotifs.forEach(n => {
        _fbRT.seenNotifIds.add(n.id);
        _fbRTToast(n);
        _fbRTPrependToDropdown(n);
    });

    // Re-render dropdown if it's open so read/unread states stay in sync
    _fbRTRenderDropdown(notifications);
}

// ── Bell badge ────────────────────────────────────────────────────────────────

function _fbRTUpdateBellBadge(count) {
    // Suppresses the existing polling/WS badge updater — we own it now
    const ids = ['notificationBadge', 'notifBadge', 'notif-badge', 'bellBadge'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent   = count > 99 ? '99+' : String(count);
        el.style.display = count > 0  ? 'inline-block' : 'none';
    });

    // Also update any badge stored on the realtime-updates.js side so its
    // polling doesn't overwrite our count
    if (typeof _updateBellBadge === 'function') _updateBellBadge(count);
}

// ── Dropdown rendering ────────────────────────────────────────────────────────

function _fbRTRenderDropdown(notifications) {
    const panel = _fbRTFindNotifPanel();
    if (!panel) return;

    const list = panel.querySelector(
        '.notifications-list, .notif-list, [data-notif-list], ul'
    );
    if (!list) return;

    // Only re-render when the panel is visible so we don't wipe the DOM
    // while the user can't see it
    if (panel.style.display === 'none' || panel.hidden || getComputedStyle(panel).display === 'none') {
        return;
    }

    if (!notifications.length) {
        list.innerHTML = '<li class="notif-empty">No notifications yet.</li>';
        return;
    }

    list.innerHTML = notifications.map(n => `
        <li class="notif-item${n.is_read ? '' : ' notif-item--unread'}" data-notif-id="${_fbRTEsc(n.id)}">
            <a href="${_fbRTEsc(n.link || '#')}" class="notif-link" onclick="_fbRTMarkRead('${_fbRTEsc(n.id)}')">
                ${n.actor_avatar
                    ? `<img src="${_fbRTEsc(n.actor_avatar)}" alt="" class="notif-avatar">`
                    : `<span class="notif-avatar notif-avatar--icon"><i class="fas fa-bell"></i></span>`}
                <div class="notif-body">
                    <span class="notif-title">${_fbRTEsc(n.title)}</span>
                    ${n.message ? `<span class="notif-msg">${_fbRTEsc(n.message)}</span>` : ''}
                    <span class="notif-time">${_fbRTTimeAgo(n.created_at)}</span>
                </div>
                ${!n.is_read ? '<span class="notif-dot"></span>' : ''}
            </a>
        </li>`).join('');
}

function _fbRTPrependToDropdown(n) {
    const panel = _fbRTFindNotifPanel();
    if (!panel || panel.style.display === 'none' || panel.hidden) return;

    const list = panel.querySelector(
        '.notifications-list, .notif-list, [data-notif-list], ul'
    );
    if (!list) return;

    // Remove "empty" placeholder if present
    const empty = list.querySelector('.notif-empty');
    if (empty) empty.remove();

    const item = document.createElement('li');
    item.className = 'notif-item notif-item--unread notif-item--new';
    item.dataset.notifId = n.id;
    item.innerHTML = `
        <a href="${_fbRTEsc(n.link || '#')}" class="notif-link" onclick="_fbRTMarkRead('${_fbRTEsc(n.id)}')">
            ${n.actor_avatar
                ? `<img src="${_fbRTEsc(n.actor_avatar)}" alt="" class="notif-avatar">`
                : `<span class="notif-avatar notif-avatar--icon"><i class="fas fa-bell"></i></span>`}
            <div class="notif-body">
                <span class="notif-title">${_fbRTEsc(n.title)}</span>
                ${n.message ? `<span class="notif-msg">${_fbRTEsc(n.message)}</span>` : ''}
                <span class="notif-time">just now</span>
            </div>
            <span class="notif-dot"></span>
        </a>`;
    list.insertBefore(item, list.firstChild);
}

function _fbRTFindNotifPanel() {
    return (
        document.getElementById('notificationsPanel') ||
        document.getElementById('notifPanel') ||
        document.querySelector('.notifications-dropdown') ||
        document.querySelector('[data-notifications-panel]') ||
        null
    );
}

// ── Mark read (called when user clicks a notification) ────────────────────────

window._fbRTMarkRead = async function(notifId) {
    if (!notifId) return;
    try {
        // Update Firestore directly (best-effort — even if it fails the link opens)
        if (_fbRT.ready && _fbRT.db) {
            await _fbRT.db.collection(NOTIF_COLL).doc(notifId).update({ is_read: true });
        }
        // Also hit the REST endpoint so PostgreSQL stays in sync
        const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
        if (token) {
            const base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
            fetch(`${base}/notifications/read/`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
                body:    JSON.stringify({ ids: [notifId] }),
            }).catch(() => {});
        }
        // Update DOM immediately
        const item = document.querySelector(`[data-notif-id="${notifId}"]`);
        if (item) {
            item.classList.remove('notif-item--unread');
            item.querySelector('.notif-dot')?.remove();
        }
    } catch (_) { /* non-critical */ }
};

// Mark ALL notifications as read (for "mark all read" button)
window.fbRTMarkAllRead = async function() {
    try {
        const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
        if (!token) return;
        const base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
        await fetch(`${base}/notifications/read/`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Token ${token}` },
            body:    JSON.stringify({}),   // empty = mark all
        });
        // Firestore docs will be updated server-side via the REST endpoint
        _fbRTUpdateBellBadge(0);
    } catch (_) { /* non-critical */ }
};

// ── Toast for new notifications ───────────────────────────────────────────────

function _fbRTToast(n) {
    const actor  = n.actor_display || 'Someone';
    const icons  = {
        follow:   '👤',
        comment:  '💬',
        reaction: '🔥',
        share:    '🔗',
        mention:  '📣',
        system:   '🔔',
    };
    const icon = icons[n.notif_type] || '🔔';
    const msg  = n.title
        ? `${actor} — ${n.title} ${icon}`
        : `New notification ${icon}`;

    if (typeof showToast === 'function')   { showToast(msg, 'info');   return; }
    if (typeof _rtToast  === 'function')   { _rtToast(msg,  'info');   return; }
    if (typeof socialToast === 'function') { socialToast(msg, 'info'); return; }

    // Minimal built-in toast as last resort
    _fbRTBuiltinToast(msg);
}

function _fbRTBuiltinToast(msg) {
    let box = document.getElementById('_fbRT_toastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = '_fbRT_toastBox';
        box.style.cssText =
            'position:fixed;bottom:20px;right:20px;z-index:99999;' +
            'display:flex;flex-direction:column;gap:8px;pointer-events:none;';
        document.body.appendChild(box);
    }
    const t = document.createElement('div');
    t.style.cssText =
        'background:#556b2f;color:#fff;padding:10px 16px;border-radius:10px;' +
        'font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.2);' +
        'opacity:0;transform:translateY(6px);transition:all .22s ease;max-width:320px;';
    t.textContent = msg;
    box.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 4000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Messenger unread badge listener
//  (lightweight — only tracks unread_counts, full message UI is in firebase-messenger.js)
// ─────────────────────────────────────────────────────────────────────────────

function _fbRTAttachConvBadgeListener(userId) {
    if (!_fbRT.ready || !_fbRT.db) return;

    // If the messenger page is open, firebase-messenger.js already manages this
    // listener. Skip here to avoid double listeners.
    if (typeof _fb !== 'undefined' && _fb.ready) return;

    if (_fbRT.convListUnsub) { _fbRT.convListUnsub(); _fbRT.convListUnsub = null; }

    _fbRT.convListUnsub = _fbRT.db
        .collection(CONV_COLL)
        .where('participant_ids', 'array-contains', String(userId))
        .orderBy('updated_at', 'desc')
        .limit(30)
        .onSnapshot(
            snapshot => _fbRTHandleConvBadge(snapshot, userId),
            err => console.warn('[ARTX] Conv badge listener error:', err.message)
        );
}

function _fbRTHandleConvBadge(snapshot, userId) {
    let totalUnread = 0;
    snapshot.forEach(doc => {
        const d = doc.data();
        totalUnread += (d.unread_counts || {})[String(userId)] || 0;
    });

    // Update messenger badge(s) — IDs used in messenger.html and index.html
    const ids = ['msgBadge', 'msgBadgeMobile', 'messengerBadge', 'dmBadge'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent   = totalUnread > 9 ? '9+' : String(totalUnread);
        el.style.display = totalUnread > 0 ? '' : 'none';
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SDK loader
// ─────────────────────────────────────────────────────────────────────────────

function _fbRTLoadSDK() {
    return new Promise((resolve, reject) => {
        // Already loaded?
        if (window.firebase && window.firebase.firestore) { resolve(); return; }

        const needed = [];
        if (!window.firebase || !window.firebase.app) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
        }
        if (!window.firebase || !window.firebase.firestore) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js');
        }
        if (!needed.length) { resolve(); return; }

        let loaded = 0;
        needed.forEach(src => {
            if (document.querySelector(`script[src="${src}"]`)) {
                // Script tag exists — wait for it to be ready
                const existing = document.querySelector(`script[src="${src}"]`);
                if (window.firebase && window.firebase.firestore) {
                    if (++loaded === needed.length) resolve();
                } else {
                    existing.addEventListener('load', () => {
                        if (++loaded === needed.length) resolve();
                    });
                }
                return;
            }
            const el = document.createElement('script');
            el.src   = src;
            el.async = false;
            el.onload  = () => { if (++loaded === needed.length) resolve(); };
            el.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(el);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Config fetch
// ─────────────────────────────────────────────────────────────────────────────

async function _fbRTFetchConfig() {
    try {
        // Try auth endpoint first (available on all pages)
        const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
        if (!token) return null;

        const base = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

        // Use the messenger firebase-config endpoint (already exists and returns the same data)
        const res = await fetch(`${base}/messenger/firebase-config/`, {
            headers: { Authorization: `Token ${token}` }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (_) {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _fbRTCurrentUserId() {
    try {
        const raw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
        return raw ? JSON.parse(raw)?.id : null;
    } catch (_) { return null; }
}

function _fbRTFormatNotif(id, d) {
    const created = d.created_at?.toDate?.()?.toISOString?.()
        ?? d.created_at?.seconds
            ? new Date(d.created_at.seconds * 1000).toISOString()
            : (d.created_at || null);
    return {
        id:           id,
        notif_type:   d.notif_type  || d.type || 'system',
        title:        d.title       || '',
        message:      d.message     || '',
        link:         d.link        || '#',
        is_read:      !!d.is_read,
        created_at:   created,
        actor_display: d.actor_display || d.actor_username || null,
        actor_avatar:  d.actor_avatar  || null,
    };
}

function _fbRTTimeAgo(isoStr) {
    if (!isoStr) return '';
    const s = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);   if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);   if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function _fbRTEsc(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Integration: suppress realtime-updates.js WS notification when Firebase
//  listeners are running so we don't get duplicate toasts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patch _connectNotifWs from realtime-updates.js so it becomes a no-op once
 * the Firebase listener is live.  This prevents the old WS path from fighting
 * with the Firestore path for badge ownership.
 *
 * We patch AFTER DOMContentLoaded so the original function has been defined.
 */
function _fbRTSuppressLegacyNotifWS() {
    if (typeof _connectNotifWs !== 'undefined') {
        // Wrap to no-op — Firestore listener owns notifications now
        window._connectNotifWs_legacy = _connectNotifWs;
        window._connectNotifWs = function() {
            // If Firebase is running, skip WS notifications — they'd be duplicates
            if (_fbRT.ready) return;
            // Firebase not ready — fall back to original
            if (typeof window._connectNotifWs_legacy === 'function') {
                window._connectNotifWs_legacy();
            }
        };
    }
    // Also stop the notification polling timer if one is running
    if (typeof _notifTimer !== 'undefined' && _notifTimer) {
        clearInterval(_notifTimer);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Auto-init on DOMContentLoaded
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    if (!token) return; // Not logged in

    // Small delay to let realtime-updates.js finish its own DOMContentLoaded setup
    await new Promise(r => setTimeout(r, 200));

    await fbRealtimeInit();

    // Suppress legacy notification WS / polling once Firebase is live
    if (_fbRT.ready) {
        _fbRTSuppressLegacyNotifWS();
    }
});

// Re-init when the user logs in (called from auth.js or app.js)
window.fbRealtimeInit   = fbRealtimeInit;
window.fbRealtimeDetach = fbRealtimeDetach;
