/**
 * ARTX Firebase Messenger — Real-time Firestore listener + Firebase Storage voice upload
 * =========================================================================================
 * Architecture:
 *   Voice recording workflow:
 *     1. MediaRecorder captures real mic audio via getUserMedia
 *     2. Blob is uploaded to Firebase Storage (voice-notes/{convId}/{timestamp}.webm)
 *     3. Public download URL is retrieved from Firebase Storage
 *     4. Message written to Firestore sub-collection → recipient's onSnapshot fires instantly
 *     5. Message also POSTed to Django REST API (firebase_media_url param) → PostgreSQL
 *
 *   Text / image workflow (unchanged):
 *     Django REST → post_save signal → Firestore mirror → onSnapshot
 *
 * Falls back to the existing REST polling (messenger.js) when Firebase is not configured.
 */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const _fb = {
    app:             null,
    db:              null,
    storage:         null,   // Firebase Storage instance
    ready:           false,
    storageReady:    false,  // true when firebase-storage SDK is loaded
    convListUnsub:   null,
    msgUnsub:        null,
    activeConvId:    null,
    config:          null,   // cached Firebase config from Django
};

const CONV_COLL = 'messenger_conversations';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function fbMessengerInit() {
    if (_fb.ready) {
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
        _fb.config = config;

        // 2. Load Firebase JS SDK (app + firestore + storage compat)
        await _fbLoadSDK();

        // 3. Initialise app (idempotent)
        const firebase = window.firebase;
        if (!firebase) throw new Error('Firebase SDK not loaded');

        if (!firebase.apps?.length) {
            _fb.app = firebase.initializeApp(config);
        } else {
            _fb.app = firebase.apps[0];
        }

        _fb.db    = firebase.firestore(_fb.app);
        _fb.ready = true;

        // 4. Storage (may be undefined if storageBucket not configured)
        if (config.storageBucket && firebase.storage) {
            try {
                _fb.storage     = firebase.storage(_fb.app);
                _fb.storageReady = true;
            } catch (e) {
                console.warn('Firebase Storage init failed:', e.message);
            }
        }

        // 5. Attach conversation list listener
        _fbAttachConvListListener();

        console.info(
            `Firebase Messenger: real-time listeners active.` +
            (_fb.storageReady ? ' Storage: enabled (voice upload).' : ' Storage: disabled (will use Django media).')
        );
    } catch (err) {
        console.warn('Firebase Messenger init failed — falling back to polling.', err);
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
        // All needed SDKs already loaded?
        if (window.firebase && window.firebase.firestore && window.firebase.storage) {
            resolve();
            return;
        }

        const needed = [];
        if (!window.firebase || !window.firebase.app) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
        }
        if (!window.firebase || !window.firebase.firestore) {
            needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js');
        }
        // Always load storage for voice note upload
        needed.push('https://www.gstatic.com/firebasejs/10.12.5/firebase-storage-compat.js');

        if (!needed.length) { resolve(); return; }

        // FIX Bug 8: the old code incremented `loaded` for already-present scripts
        // but returned early, meaning the counter could never reach needed.length
        // for remaining scripts. New approach: filter out already-injected scripts
        // upfront so `needed` only contains scripts that actually need loading.
        const toLoad = needed.filter(src => !document.querySelector(`script[src="${src}"]`));

        if (!toLoad.length) {
            // All scripts already injected — wait one tick for them to execute
            setTimeout(resolve, 0);
            return;
        }

        let loaded = 0;
        toLoad.forEach(src => {
            const el = document.createElement('script');
            el.src   = src;
            el.async = false;
            el.onload  = () => { if (++loaded === toLoad.length) resolve(); };
            el.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(el);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Firebase Storage — voice note upload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload an audio Blob/File to Firebase Storage.
 * Returns the public download URL on success, or null on failure.
 *
 * Path:  voice-notes/{conversationId}/{timestamp}-{random}.{ext}
 *
 * @param {Blob|File} audioBlob  - The recorded audio blob
 * @param {string}    mimeType   - MIME type (e.g. 'audio/webm;codecs=opus')
 * @param {string|number} convId - Conversation ID
 * @param {function}  onProgress - Optional progress callback(percent 0-100)
 */
async function fbUploadVoiceNote(audioBlob, mimeType, convId, onProgress) {
    if (!_fb.storageReady || !_fb.storage) {
        console.warn('Firebase Storage not available — falling back to Django upload.');
        return null;
    }

    // Validate the blob has actual data
    if (!audioBlob || audioBlob.size === 0) {
        console.error('fbUploadVoiceNote: audio blob is empty!');
        return null;
    }

    const ext  = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
               : mimeType.includes('ogg') ? 'ogg'
               : 'webm';
    const path = `voice-notes/${convId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const ref  = _fb.storage.ref(path);

    try {
        const metadata = { contentType: mimeType };
        const uploadTask = ref.put(audioBlob, metadata);

        // Track upload progress
        await new Promise((resolve, reject) => {
            uploadTask.on(
                'state_changed',
                snapshot => {
                    const pct = Math.round(
                        (snapshot.bytesTransferred / snapshot.totalBytes) * 100
                    );
                    if (typeof onProgress === 'function') onProgress(pct);
                },
                err => reject(err),
                () => resolve(),
            );
        });

        const downloadURL = await ref.getDownloadURL();
        console.info(`Voice note uploaded to Firebase Storage: ${path} (${audioBlob.size} bytes)`);
        return downloadURL;
    } catch (err) {
        console.error('Firebase Storage upload failed:', err);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Write voice message directly to Firestore (for instant delivery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a voice message document directly to Firestore so the recipient's
 * onSnapshot listener fires immediately (no backend round-trip latency).
 * This is called BEFORE the Django REST POST so the message appears instantly.
 *
 * The Django REST POST then confirms persistence and may emit its own signal,
 * but the signal in signals.py will skip re-writing since the doc already exists.
 */
async function _fbWriteVoiceMessageToFirestore(convId, senderInfo, mediaUrl, durationSec, tempId) {
    if (!_fb.ready || !_fb.db) return null;

    const now    = firebase.firestore.Timestamp.now();
    const msgDoc = {
        id:              tempId,
        conversation_id: String(convId),
        sender_id:       String(senderInfo.id),
        sender_username: senderInfo.username || '',
        sender_avatar:   senderInfo.avatar   || null,
        message_type:    'audio',
        text:            null,
        media_url:       mediaUrl,
        media_duration:  durationSec || null,
        timestamp:       now,
        read:            false,
    };

    try {
        // FIX Bug 7: removed dead `convRef` variable that was computed but never used.
        const db = _fb.db;
        await db.collection(CONV_COLL)
            .doc(String(convId))
            .collection('messages')
            .doc(tempId)
            .set(msgDoc);

        // Update conversation summary for sidebar
        await db.collection(CONV_COLL).doc(String(convId)).set({
            last_message: {
                id:           tempId,
                message_type: 'audio',
                text:         null,
                sender_id:    String(senderInfo.id),
                timestamp:    now,
                read:         false,
            },
            updated_at: now,
        }, { merge: true });

        return tempId;
    } catch (err) {
        console.error('_fbWriteVoiceMessageToFirestore failed:', err);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Patched dmSendMessage — intercepts voice sends to use Firebase Storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Override messenger.js's dmSendMessage for voice notes when Firebase Storage is available.
 * Workflow:
 *   1. Upload Blob to Firebase Storage → get download URL
 *   2. Write to Firestore directly (recipient sees it immediately)
 *   3. POST to Django REST API with firebase_media_url
 *   4. Re-render messages (Firestore listener will also update, that's fine)
 */
async function _fbSendVoiceMessage(convId, pendingMedia) {
    const { file, duration } = pendingMedia;

    // Show upload progress in the voice preview strip
    const strip = document.getElementById('dmComposePreview');
    if (strip) {
        const durationLabel = duration ? ` — ${_dmFmtDuration(duration)}` : '';
        strip.innerHTML = `
            <div class="dm-voice-preview-inner" id="fbUploadProgress">
                <i class="fas fa-cloud-upload-alt" style="color:#556b2f;font-size:18px;"></i>
                <span id="fbUploadLabel">Uploading voice note…</span>
            </div>`;
    }

    const onProgress = (pct) => {
        const label = document.getElementById('fbUploadLabel');
        if (label) label.textContent = `Uploading… ${pct}%`;
    };

    // 1. Upload to Firebase Storage
    const downloadURL = await fbUploadVoiceNote(file, file.type, convId, onProgress);

    if (!downloadURL) {
        // Firebase Storage unavailable — fall back to Django multipart upload
        console.warn('Firebase Storage upload failed — falling back to Django REST upload.');
        if (strip) strip.innerHTML = '';
        strip?.classList.remove('visible');
        return false; // signal caller to use the original Django send path
    }

    // 2. Get current user info for Firestore document
    const currentUser = _fbGetCurrentUser();

    // 3. Write to Firestore immediately (instant real-time delivery)
    const tempId = `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await _fbWriteVoiceMessageToFirestore(
        convId,
        currentUser,
        downloadURL,
        duration,
        tempId,
    );

    // 4. POST to Django (persistence + PostgreSQL) — non-blocking, best-effort
    try {
        const token = localStorage.getItem('djangoAuthToken')
                   || localStorage.getItem('authToken')
                   || (typeof apiService !== 'undefined' ? apiService.token : null);

        const fd = new FormData();
        fd.append('message_type', 'audio');
        fd.append('firebase_media_url', downloadURL);
        if (duration) fd.append('duration', String(Math.round(duration)));

        const apiBase = (typeof _dmApiBase === 'function') ? _dmApiBase()
            : ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`);

        await fetch(`${apiBase}/messenger/conversations/${convId}/send_message/`, {
            method:  'POST',
            headers: token ? { Authorization: `Token ${token}` } : {},
            body:    fd,
        });
    } catch (err) {
        // Non-critical — Firestore already has the message
        console.warn('Django REST voice message save failed (non-critical):', err.message);
    }

    // 5. Clean up compose bar
    if (typeof dmRemoveMedia === 'function') dmRemoveMedia();

    return true; // handled by Firebase path
}

// ─────────────────────────────────────────────────────────────────────────────
//  Conversation list listener
// ─────────────────────────────────────────────────────────────────────────────

function _fbAttachConvListListener() {
    if (!_fb.ready || !_fb.db) return;

    const currentUserId = _fbCurrentUserId();
    if (!currentUserId) return;

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

    if (typeof _dm !== 'undefined') {
        _dm.conversations = convs;
        if (typeof dmRenderConvList === 'function') dmRenderConvList(convs);
        if (typeof dmUpdateBadge    === 'function') dmUpdateBadge();
    }

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

function fbAttachMessageListener(convId) {
    if (!_fb.ready || !_fb.db) return false;

    const currentUserId = _fbCurrentUserId();

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

    return true;
}

function _fbHandleMessageUpdate(snapshot, currentUserId) {
    const container = document.getElementById('dmMessages');
    if (!container) return;

    const msgs = [];
    snapshot.forEach(doc => {
        const d   = doc.data();
        // Normalise Firestore Timestamps → ISO strings for dmRenderMessages
        const ts  = d.timestamp?.toDate?.()?.toISOString?.() ?? d.timestamp ?? null;
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

        // Kill REST polling if Firestore listeners are running
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
        if (_fb.msgUnsub) {
            _fb.msgUnsub();
            _fb.msgUnsub = null;
        }
        _fb.activeConvId = null;
    };

    // ── Wrap dmSendMessage — intercept voice sends for Firebase Storage ───────
    window.dmSendMessage = async function (event) {
        event.preventDefault();

        const convId = typeof _dm !== 'undefined' ? _dm.activeConvId : null;
        if (!convId) return;

        const pendingMedia = typeof _dm !== 'undefined' ? _dm.pendingMedia : null;

        // Only intercept audio sends when Firebase Storage is ready
        if (
            pendingMedia &&
            pendingMedia.type === 'audio' &&
            pendingMedia.file &&
            pendingMedia.file.size > 0 &&
            _fb.storageReady
        ) {
            const sendBtn = document.querySelector('.dm-send-btn');
            if (sendBtn) sendBtn.disabled = true;

            try {
                const handled = await _fbSendVoiceMessage(convId, pendingMedia);
                if (handled) {
                    // Firebase path succeeded — nothing more to do
                    return;
                }
                // Fall through to original send if Firebase path returned false
            } catch (err) {
                console.error('_fbSendVoiceMessage error:', err);
                if (typeof showToast === 'function') {
                    showToast('Upload failed. Trying alternative send…', 'error');
                }
            } finally {
                if (sendBtn) sendBtn.disabled = false;
            }
        }

        // Default path: text messages, image/video, or Firebase Storage unavailable
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

function _fbGetCurrentUser() {
    try {
        const raw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
        const u   = raw ? JSON.parse(raw) : {};
        return {
            id:       u.id       || null,
            username: u.username || u.display_name || 'User',
            avatar:   u.profile_image || u.profile_image_url || null,
        };
    } catch (_) {
        return { id: null, username: 'User', avatar: null };
    }
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

// ─────────────────────────────────────────────────────────────────────────────
//  Firestore message renderer — handles Firestore message shape
//  (sender_id / media_url fields instead of sender.id / media_url)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * dmRenderMessages in messenger.js handles both REST and Firestore shapes.
 * Firestore messages use sender_id (string) instead of sender.id (object).
 * We patch the currentUserId comparison to handle both shapes transparently.
 *
 * The existing dmRenderMessages already handles msg.sender?.id || msg.sender
 * so it naturally falls back to sender_id for Firestore documents.
 * No additional patching needed here — the shapes are already compatible.
 */

// Expose public API
window.fbMessengerInit         = fbMessengerInit;
window.fbMessengerDetach       = fbMessengerDetach;
window.fbAttachMessageListener = fbAttachMessageListener;
window.fbUploadVoiceNote       = fbUploadVoiceNote;
