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
    // Pre-warm the People panel in the background.
    // Elements exist in the DOM (just hidden), so this will render users
    // immediately — they'll be visible the moment the user clicks People.
    setTimeout(() => { _dmLoadPeoplePanel(); }, 1200);
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

        // Build the preview text — voice messages get a mic icon label
        let preview = 'Say hello 👋';
        if (last) {
            if (last.message_type === 'audio') {
                preview = '🎤 Voice message';
            } else if (last.message_type === 'image') {
                preview = '📷 Photo';
            } else if (last.message_type === 'video') {
                preview = '🎥 Video';
            } else if (last.message_type !== 'text') {
                preview = `📎 ${last.message_type}`;
            } else {
                preview = last.text || '';
            }
        }

        // Is the last message a voice message? Render a styled pill instead of plain text
        const isVoice  = last?.message_type === 'audio';
        const previewHtml = isVoice
            ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:#556b2f;background:rgba(85,107,47,0.1);border-radius:999px;padding:2px 8px;">
                   <i class="fas fa-microphone" style="font-size:9px;"></i> Voice message
               </span>`
            : `<span>${_escHtml(preview.slice(0, 55))}</span>`;
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
                <div class="dm-conv-preview ${unread ? 'unread' : ''}">${previewHtml}</div>
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
            bubbleContent = src
                ? `<img src="${_escHtml(src)}" alt="image" onclick="window.open(this.src,'_blank')">`
                : '[image]';
        } else if (msg.message_type === 'video') {
            const src = msg.media_url || msg.media_file;
            bubbleContent = src ? `<video src="${_escHtml(src)}" controls></video>` : '[video]';
        } else if (msg.message_type === 'audio') {
            // Rich voice message player with waveform
            const src = msg.media_url || msg.media_file;
            const msgId = `vm_${msg.id || Date.now()}_${Math.random().toString(36).slice(2,6)}`;
            const dur = msg.media_duration ? _dmFmtDuration(msg.media_duration) : '';
            if (src) {
                bubbleContent = `
                <audio id="audio_${msgId}" src="${_escHtml(src)}" preload="metadata"
                       onloadedmetadata="(function(a){
                           const el=document.getElementById('dur_${msgId}');
                           if(el&&a.duration&&isFinite(a.duration))
                               el.textContent=window._dmFmtDuration(Math.round(a.duration));
                       })(this)"
                       onended="(function(){
                           const btn=document.getElementById('play_${msgId}');
                           const icon=btn&&btn.querySelector('i');
                           if(icon){icon.className='fas fa-play';}
                       })()">
                </audio>
                <div class="dm-voice-bubble">
                    <button class="dm-voice-play" id="play_${msgId}"
                            onclick="_dmToggleVoice('audio_${msgId}','play_${msgId}')"
                            type="button" title="Play voice message">
                        <i class="fas fa-play"></i>
                    </button>
                    <div class="dm-voice-waveform" id="wave_${msgId}">${_dmVoiceWaveform(18)}</div>
                    <span class="dm-voice-dur" id="dur_${msgId}">${dur || '0:00'}</span>
                </div>`;
            } else {
                bubbleContent = `<span style="display:inline-flex;align-items:center;gap:5px;">
                    <i class="fas fa-microphone"></i> Voice message
                </span>`;
            }
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
            // Send duration for audio so the receiver sees the correct length
            if (_dm.pendingMedia.type === 'audio' && _dm.pendingMedia.duration) {
                fd.append('duration', String(Math.round(_dm.pendingMedia.duration)));
            }
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
        _dmShowPreview(type, e.target.result, file.name);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function dmRemoveMedia() {
    _dm.pendingMedia = null;
    _dmHidePreview();
    // Reset voice UI if applicable
    _dmStopRecordingUI();
}

/** Show the compose preview strip (image thumb or voice indicator) */
function _dmShowPreview(type, dataUrl, label) {
    const strip = document.getElementById('dmComposePreview');
    if (!strip) return;

    if (type === 'image') {
        strip.innerHTML = `
            <img src="${dataUrl}" alt="" class="dm-media-thumb">
            <button type="button" class="dm-preview-remove" onclick="dmRemoveMedia()" title="Remove">&times;</button>`;
    } else if (type === 'audio') {
        strip.innerHTML = `
            <div class="dm-voice-preview-inner">
                <i class="fas fa-microphone"></i>
                <span>${label || 'Voice message'}</span>
            </div>
            <button type="button" class="dm-preview-remove" onclick="dmRemoveMedia()" title="Remove">&times;</button>`;
    } else {
        strip.innerHTML = `
            <div class="dm-voice-preview-inner">
                <i class="fas fa-paperclip"></i>
                <span>${_escHtml(label || type)}</span>
            </div>
            <button type="button" class="dm-preview-remove" onclick="dmRemoveMedia()" title="Remove">&times;</button>`;
    }
    strip.classList.add('visible');
}

function _dmHidePreview() {
    const strip = document.getElementById('dmComposePreview');
    if (strip) { strip.innerHTML = ''; strip.classList.remove('visible'); }
}

// ── Voice recording ───────────────────────────────────────────────────────────
const _rec = {
    mediaRecorder: null,
    chunks:        [],
    startTime:     null,
    timerInterval: null,
    aborted:       false,
    stream:        null,
    analyser:      null,   // Web Audio AnalyserNode — reads mic levels
    animFrame:     null,   // requestAnimationFrame handle for waveform
    audioCtx:      null,   // AudioContext instance
};

async function dmStartRecording() {
    // Don't start a new recording if one is already active
    if (_rec.mediaRecorder && _rec.mediaRecorder.state !== 'inactive') return;

    // Reset abort flag for this new recording attempt
    _rec.aborted  = false;
    _rec.stream   = null;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // If stop was called while we were waiting for permission, clean up and bail
        if (_rec.aborted) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        _rec.stream = stream;

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : 'audio/ogg';

        _rec.chunks        = [];
        _rec.startTime     = Date.now();
        _rec.mediaRecorder = new MediaRecorder(stream, { mimeType });

        _rec.mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) _rec.chunks.push(e.data);
        };

        _rec.mediaRecorder.onstop = () => {
            // Always release the mic
            stream.getTracks().forEach(t => t.stop());
            _rec.stream = null;

            // If aborted or too short, discard
            if (_rec.aborted || _rec.chunks.length === 0) {
                _dmStopRecordingUI();
                return;
            }

            const blob = new Blob(_rec.chunks, { type: mimeType });
            const durationSec = Math.round((Date.now() - _rec.startTime) / 1000);

            if (durationSec < 1) {
                _dmStopRecordingUI();
                if (typeof showToast === 'function') showToast('Hold longer to record.', 'info');
                return;
            }

            const ext  = mimeType.includes('ogg') ? 'ogg' : 'webm';
            const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mimeType });
            _dm.pendingMedia = { file, type: 'audio', dataUrl: null, duration: durationSec };

            _dmStopRecordingUI();
            _dmShowPreview('audio', null, `Voice message — ${_dmFmtDuration(durationSec)}`);
        };

        _rec.mediaRecorder.start(100);

        // ── Update UI ──────────────────────────────────────────────────────
        const btn = document.getElementById('dmVoiceBtn');
        if (btn) btn.classList.add('recording');

        const timer = document.getElementById('dmRecTimer');
        if (timer) timer.classList.add('visible');

        // Hide text input, show live waveform canvas
        const textInput = document.getElementById('dmTextInput');
        const liveWave  = document.getElementById('dmLiveWave');
        if (textInput) textInput.style.display = 'none';
        if (liveWave)  liveWave.classList.add('visible');

        // ── Web Audio visualiser ────────────────────────────────────────────
        try {
            _rec.audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
            const source   = _rec.audioCtx.createMediaStreamSource(stream);
            _rec.analyser  = _rec.audioCtx.createAnalyser();
            _rec.analyser.fftSize       = 128;
            _rec.analyser.smoothingTimeConstant = 0.6;
            source.connect(_rec.analyser);
            _dmDrawLiveWave();
        } catch (audioErr) {
            // AudioContext unavailable — waveform just shows static bars
            console.warn('AudioContext unavailable:', audioErr.message);
        }

        // ── Live timer ──────────────────────────────────────────────────────
        _rec.timerInterval = setInterval(() => {
            const elapsed = Math.round((Date.now() - _rec.startTime) / 1000);
            const el = document.getElementById('dmRecTimerVal');
            if (el) el.textContent = `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
        }, 500);

    } catch (err) {
        _rec.aborted = false; // reset so next attempt works
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            if (typeof showToast === 'function') showToast('Microphone permission denied.', 'error');
        } else if (err.name === 'NotFoundError') {
            if (typeof showToast === 'function') showToast('No microphone found.', 'error');
        } else {
            console.error('Recording error:', err);
        }
    }
}

function dmStopRecording() {
    // Mark as aborted so the onstop handler discards the recording if
    // getUserMedia hasn't resolved yet (fast tap / permission dialog race)
    _rec.aborted = true;

    if (_rec.mediaRecorder && _rec.mediaRecorder.state !== 'inactive') {
        _rec.aborted = false; // recording was active — process it normally
        _rec.mediaRecorder.stop();
    } else if (_rec.stream) {
        // getUserMedia resolved but MediaRecorder not started yet — kill the stream
        _rec.stream.getTracks().forEach(t => t.stop());
        _rec.stream = null;
        _dmStopRecordingUI();
    }

    _rec.mediaRecorder = null;
}

function _dmStopRecordingUI() {
    // Cancel waveform animation
    if (_rec.animFrame) {
        cancelAnimationFrame(_rec.animFrame);
        _rec.animFrame = null;
    }
    // Close AudioContext and release resources
    if (_rec.audioCtx) {
        _rec.audioCtx.close().catch(() => {});
        _rec.audioCtx = null;
        _rec.analyser = null;
    }

    clearInterval(_rec.timerInterval);
    _rec.timerInterval = null;

    // Reset compose bar UI
    const btn = document.getElementById('dmVoiceBtn');
    if (btn) btn.classList.remove('recording');

    const timer = document.getElementById('dmRecTimer');
    if (timer) timer.classList.remove('visible');

    const liveWave = document.getElementById('dmLiveWave');
    if (liveWave) liveWave.classList.remove('visible');

    const textInput = document.getElementById('dmTextInput');
    if (textInput) textInput.style.display = '';

    // Clear canvas
    const canvas = document.getElementById('dmWaveCanvas');
    if (canvas) {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    }
}

/**
 * Draw the live microphone waveform onto the canvas while recording.
 * Uses the Web Audio AnalyserNode to read real frequency data.
 * Falls back to animated random bars if AudioContext isn't available.
 */
function _dmDrawLiveWave() {
    const canvas = document.getElementById('dmWaveCanvas');
    if (!canvas) return;

    const ctx    = canvas.getContext('2d');
    const W      = canvas.offsetWidth  || 140;
    const H      = canvas.offsetHeight || 36;
    canvas.width  = W;
    canvas.height = H;

    // Bar settings
    const BAR_COUNT  = 28;
    const BAR_GAP    = 2;
    const BAR_W      = Math.floor((W - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT);
    const COLOR_MID  = '#ef4444';
    const COLOR_LOW  = 'rgba(239,68,68,0.35)';

    function draw() {
        if (!_rec.mediaRecorder || _rec.mediaRecorder.state === 'inactive') return;

        _rec.animFrame = requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);

        let levels;

        if (_rec.analyser) {
            // Real audio data from microphone
            const bufLen = _rec.analyser.frequencyBinCount;
            const data   = new Uint8Array(bufLen);
            _rec.analyser.getByteFrequencyData(data);

            // Map frequency bins to bar count (use lower 60% of spectrum = voice range)
            const voiceBins = Math.floor(bufLen * 0.6);
            levels = Array.from({ length: BAR_COUNT }, (_, i) => {
                const start = Math.floor(i * voiceBins / BAR_COUNT);
                const end   = Math.floor((i + 1) * voiceBins / BAR_COUNT);
                let sum = 0;
                for (let j = start; j < end; j++) sum += data[j];
                return sum / Math.max(end - start, 1); // 0–255
            });
        } else {
            // No AudioContext — animated random fallback
            levels = Array.from({ length: BAR_COUNT }, () => Math.random() * 180 + 20);
        }

        // Draw bars centred vertically
        levels.forEach((level, i) => {
            const normH   = Math.max(3, (level / 255) * (H - 4));
            const x       = i * (BAR_W + BAR_GAP);
            const y       = (H - normH) / 2;
            ctx.fillStyle = level > 80 ? COLOR_MID : COLOR_LOW;
            ctx.beginPath();
            ctx.roundRect
                ? ctx.roundRect(x, y, BAR_W, normH, 2)
                : ctx.rect(x, y, BAR_W, normH);
            ctx.fill();
        });
    }

    draw();
}

/** Build the waveform bars for a voice bubble (purely decorative) */
function _dmVoiceWaveform(count = 20) {
    const heights = Array.from({ length: count }, () => Math.floor(Math.random() * 16) + 4);
    return heights.map(h =>
        `<div class="dm-voice-bar" style="height:${h}px;"></div>`
    ).join('');
}

/** Format seconds as M:SS */
function _dmFmtDuration(seconds) {
    const s = Math.round(seconds || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
    if (typeof apiService !== 'undefined' && !apiService.token) {
        apiService.token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken') || null;
    }

    try {
        const data = await DM_API.availableUsers('');
        // API may return an array directly or a paginated {results:[]} object
        const users = Array.isArray(data) ? data : (data.results || []);
        _dmRenderUserResults(users);
    } catch (e) {
        console.error('dmLoadSuggestedUsers error:', e);
        results.innerHTML = `<p class="dm-hint">Could not load users (${e.message || 'network error'}). Try searching.</p>`;
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
    if (typeof apiService !== 'undefined' && !apiService.token) {
        apiService.token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken') || null;
    }

    _dm.searchDebounce = setTimeout(async () => {
        if (results) results.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';
        try {
            const data = await DM_API.availableUsers(query);
            const users = Array.isArray(data) ? data : (data.results || []);
            _dmRenderUserResults(users);
        } catch (e) {
            console.error('dmSearchUsers error:', e);
            if (results) results.innerHTML = `<p class="dm-hint">Search failed (${e.message || 'network error'}). Try again.</p>`;
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
window.dmSwitchTab = dmSwitchTab;
window.dmSearchPeople = dmSearchPeople;
window._dmToggleFollow = _dmToggleFollow;
window._dmPersonMessage = _dmPersonMessage;

// Shared helper — same base URL pattern as realtime-updates.js
function _dmApiBase() {
    return (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
    ) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
}

// Shared headers helper
function _dmHeaders() {
    // Always read fresh from localStorage — apiService may have been constructed
    // before the token was stored (e.g. after a redirect from login)
    const token = localStorage.getItem('djangoAuthToken')
               || localStorage.getItem('authToken')
               || (typeof apiService !== 'undefined' ? apiService.token : null)
               || null;
    // Keep apiService in sync if it exists
    if (token && typeof apiService !== 'undefined' && !apiService.token) {
        apiService.token = token;
    }
    return token
        ? { 'Content-Type': 'application/json', 'Authorization': `Token ${token}` }
        : { 'Content-Type': 'application/json' };
}

// Retry handler referenced from error HTML
window._dmRetryPeople = function(e) {
    e.preventDefault();
    _dmActivePeopleLoaded = false;
    // Reset spinners before reloading
    const onlineEl   = document.getElementById('dmPeopleOnline');
    const discoverEl = document.getElementById('dmPeopleDiscover');
    if (onlineEl)   onlineEl.innerHTML   = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';
    if (discoverEl) discoverEl.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';
    _dmLoadPeoplePanel();
    _dmActivePeopleLoaded = true;
};

// ── Tab switcher ─────────────────────────────────────────────────────────────
let _dmActivePeopleLoaded = false;

function dmSwitchTab(tab) {
    const chatsPanel  = document.getElementById('dmPanelChats');
    const peoplePanel = document.getElementById('dmPanelPeople');
    const tabChats    = document.getElementById('dmTabChats');
    const tabPeople   = document.getElementById('dmTabPeople');
    const searchWrap  = document.querySelector('.dm-search-wrap');

    if (tab === 'chats') {
        if (chatsPanel)  chatsPanel.style.display  = 'flex';
        if (peoplePanel) peoplePanel.style.display = 'none';
        tabChats?.classList.add('active');
        tabPeople?.classList.remove('active');
        // Restore conversation search
        if (searchWrap) {
            searchWrap.querySelector('input').placeholder = 'Search conversations…';
            searchWrap.querySelector('input').oninput = function() { dmFilterConversations(this.value); };
        }
    } else {
        if (chatsPanel)  chatsPanel.style.display  = 'none';
        if (peoplePanel) peoplePanel.style.display = 'flex';
        tabChats?.classList.remove('active');
        tabPeople?.classList.add('active');
        // Switch search to user search
        if (searchWrap) {
            searchWrap.querySelector('input').placeholder = 'Search players…';
            searchWrap.querySelector('input').value = '';
            searchWrap.querySelector('input').oninput = function() { dmSearchPeople(this.value); };
        }
        // Load people — always load when switching to this tab
        // The flag prevents duplicate loads if the background init already loaded it
        // but resets to false if the DOM wasn't ready during the background load
        if (!_dmActivePeopleLoaded) {
            _dmActivePeopleLoaded = true; // set before await so double-clicks don't double-load
            _dmLoadPeoplePanel();
        }
    }
}

// ── People panel loaders ──────────────────────────────────────────────────────

async function _dmLoadPeoplePanel() {
    const onlineEl   = document.getElementById('dmPeopleOnline');
    const discoverEl = document.getElementById('dmPeopleDiscover');

    // Elements don't exist in DOM — skip silently, retry will happen on tab click
    if (!onlineEl || !discoverEl) { _dmActivePeopleLoaded = false; return; }

    // Reset to spinners so the user sees loading feedback
    onlineEl.innerHTML   = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';
    discoverEl.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';

    try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(`${_dmApiBase()}/auth/discover/?limit=20`, {
            headers: _dmHeaders(),
            signal:  controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const data  = await res.json();
        const users = Array.isArray(data) ? data : (data.results || []);

        _dmRenderPeopleList(onlineEl,   users.slice(0, 5),  true);
        _dmRenderPeopleList(discoverEl, users.slice(0, 20), false);
        _dmActivePeopleLoaded = true;

    } catch (e) {
        _dmActivePeopleLoaded = false;
        const isTimeout = e.name === 'AbortError';
        const label = isTimeout
            ? 'Server is waking up (~30s on first load). <a href="#" onclick="_dmRetryPeople(event)">Retry</a>'
            : `${e.message} — <a href="#" onclick="_dmRetryPeople(event)">Retry</a>`;
        const html = `<p class="dm-hint" style="padding:10px 16px;font-size:12px;">${label}</p>`;
        if (onlineEl)   onlineEl.innerHTML   = html;
        if (discoverEl) discoverEl.innerHTML = '';
    }
}

async function dmSearchPeople(query) {
    const onlineEl   = document.getElementById('dmPeopleOnline');
    const discoverEl = document.getElementById('dmPeopleDiscover');

    if (!query.trim()) {
        // Restore online section visibility
        if (onlineEl) onlineEl.style.display = '';
        const onlineLabel = onlineEl?.previousElementSibling;
        if (onlineLabel) onlineLabel.style.display = '';
        _dmActivePeopleLoaded = false;
        _dmLoadPeoplePanel();
        _dmActivePeopleLoaded = true;
        return;
    }

    // Hide online section, show search spinner in discover
    const onlineLabelEl = onlineEl?.previousElementSibling;
    if (onlineEl)      onlineEl.style.display      = 'none';
    if (onlineLabelEl) onlineLabelEl.style.display = 'none';
    if (discoverEl)    discoverEl.innerHTML = '<div class="dm-empty-state"><div class="dm-spinner"></div></div>';

    try {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(
            `${_dmApiBase()}/auth/search/?q=${encodeURIComponent(query)}`,
            { headers: _dmHeaders(), signal: controller.signal }
        );
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`${res.status}`);
        const data  = await res.json();
        const users = Array.isArray(data) ? data : (data.results || []);
        _dmRenderPeopleList(discoverEl, users, false);
    } catch (e) {
        if (discoverEl) discoverEl.innerHTML =
            `<p class="dm-hint" style="padding:10px 16px;font-size:12px;">Search failed (${e.message}). <a href="#" onclick="dmSearchPeople('${_escHtml(query)}')">Retry</a></p>`;
    }
}

function _dmRenderPeopleList(container, users, showOnlineDot) {
    if (!container) return;
    if (!users || !users.length) {
        container.innerHTML = '<p class="dm-hint" style="padding:8px 16px;font-size:12px;">No users to show.</p>';
        return;
    }

    // Restore visibility in case it was hidden by search
    container.style.display = '';
    const labelEl = container.previousElementSibling;
    if (labelEl && labelEl.classList.contains('dm-conv-section-label')) {
        labelEl.style.display = '';
    }

    // Seed follow state from realtime-updates' _followingSet if available
    const followingIds = typeof _followingSet !== 'undefined'
        ? _followingSet
        : new Set();

    container.innerHTML = users.map(u => {
        const name      = _escHtml(u.display_name || u.username || 'Player');
        const initials  = _dmInitials(u.display_name || u.username || '?');
        const avatarSrc = u.profile_image || u.profile_image_url || null;
        const tier      = _escHtml(u.access_tier || 'Bronze');
        const isFollowing = followingIds.has(String(u.id));

        const avatarInner = avatarSrc
            ? `<img src="${_escHtml(avatarSrc)}" alt="${name}">`
            : `<span style="font-size:13px;font-weight:700;">${initials}</span>`;

        const onlineDot = showOnlineDot
            ? `<span class="dm-person-online-dot"></span>`
            : '';

        const followLabel = isFollowing
            ? '<i class="fas fa-check"></i> Following'
            : '<i class="fas fa-user-plus"></i> Follow';
        const followClass = isFollowing ? 'artx-follow-btn artx-follow-btn--following' : 'artx-follow-btn';

        return `<div class="dm-person-item">
            <div class="dm-person-avatar">
                ${avatarInner}${onlineDot}
            </div>
            <div class="dm-person-info">
                <div class="dm-person-name">${name}</div>
                <div class="dm-person-tier">${tier}</div>
            </div>
            <div class="dm-person-actions">
                <button class="${followClass}" data-uid="${u.id}"
                        onclick="event.stopPropagation(); _dmToggleFollow(${u.id}, this)"
                        title="${isFollowing ? 'Unfollow' : 'Follow'}">${followLabel}</button>
                <button class="dm-person-msg-btn"
                        onclick="event.stopPropagation(); _dmPersonMessage(${u.id})"
                        title="Send message">
                    <i class="fas fa-comment-dots"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

async function _dmToggleFollow(userId, btnEl) {
    if (typeof toggleFollow === 'function') {
        await toggleFollow(userId, btnEl);
        return;
    }
    // Standalone fallback — no dependency on apiService
    const isFollowing = btnEl.classList.contains('artx-follow-btn--following');
    const endpoint = isFollowing
        ? `${_dmApiBase()}/social/follows/unfollow/`
        : `${_dmApiBase()}/social/follows/follow/`;

    // Optimistic UI
    btnEl.classList.toggle('artx-follow-btn--following', !isFollowing);
    btnEl.innerHTML = !isFollowing
        ? '<i class="fas fa-check"></i> Following'
        : '<i class="fas fa-user-plus"></i> Follow';

    try {
        const res = await fetch(endpoint, {
            method:  'POST',
            headers: _dmHeaders(),
            body:    JSON.stringify({ user_id: userId })
        });
        if (!res.ok) throw new Error(`${res.status}`);
    } catch {
        // Rollback on failure
        btnEl.classList.toggle('artx-follow-btn--following', isFollowing);
        btnEl.innerHTML = isFollowing
            ? '<i class="fas fa-check"></i> Following'
            : '<i class="fas fa-user-plus"></i> Follow';
    }
}

async function _dmPersonMessage(userId) {
    // Switch to chats tab then open/create conversation
    dmSwitchTab('chats');
    await dmStartConversation(userId);
}

// ── DOMContentLoaded — badge polling only ────────────────────────────────────
// (Deep-linking and init are handled by messenger.html's own boot script)
if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // Poll unread count every 30 s so the nav badge stays current
        setInterval(async () => {
            try {
                const d = await DM_API.unreadCount();
                const n = d?.unread_count || 0;
                ['msgBadge', 'msgBadgeMobile'].forEach(id => {
                    const b = document.getElementById(id);
                    if (!b) return;
                    b.textContent   = n > 9 ? '9+' : n;
                    b.style.display = n > 0 ? '' : 'none';
                });
            } catch (_) {}
        }, 30000);
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
    if (!userId) return;
    // messenger.html lives in pages/ — user.html is a sibling
    const base = window.location.pathname.includes('/pages/') ? '' : 'pages/';
    window.location.href = `${base}user.html?id=${userId}`;
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
window.dmStartRecording    = dmStartRecording;
window.dmStopRecording     = dmStopRecording;
window._dmFmtDuration      = _dmFmtDuration;

/** Toggle play/pause on a voice message */
window._dmToggleVoice = function(audioId, btnId) {
    const audio = document.getElementById(audioId);
    const btn   = document.getElementById(btnId);
    if (!audio) return;

    // Pause all other playing audios first
    document.querySelectorAll('audio').forEach(a => {
        if (a.id !== audioId && !a.paused) {
            a.pause();
            const otherId  = a.id.replace('audio_', 'play_');
            const otherBtn = document.getElementById(otherId);
            const icon = otherBtn?.querySelector('i');
            if (icon) icon.className = 'fas fa-play';
        }
    });

    if (audio.paused) {
        audio.play().catch(() => {
            if (typeof showToast === 'function') showToast('Could not play audio.', 'error');
        });
        const icon = btn?.querySelector('i');
        if (icon) icon.className = 'fas fa-pause';
        // Animate waveform bars while playing
        const waveId = audioId.replace('audio_', 'wave_');
        _dmAnimateWaveform(waveId, audio);
    } else {
        audio.pause();
        const icon = btn?.querySelector('i');
        if (icon) icon.className = 'fas fa-play';
    }
};

/** Subtly animate waveform bars while voice plays */
function _dmAnimateWaveform(waveId, audio) {
    const container = document.getElementById(waveId);
    if (!container) return;

    const bars = container.querySelectorAll('.dm-voice-bar');
    let frame;

    function tick() {
        if (audio.paused || audio.ended) {
            // Reset bars to static heights
            bars.forEach(b => { b.style.height = (Math.floor(Math.random() * 8) + 4) + 'px'; });
            return;
        }
        bars.forEach(b => { b.style.height = (Math.floor(Math.random() * 16) + 4) + 'px'; });
        frame = requestAnimationFrame(tick);
    }
    cancelAnimationFrame(frame);
    tick();
    audio.addEventListener('pause',  () => cancelAnimationFrame(frame), { once: true });
    audio.addEventListener('ended',  () => cancelAnimationFrame(frame), { once: true });
}
