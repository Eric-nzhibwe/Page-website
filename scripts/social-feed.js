/**
 * PAGE Social Feed
 * Handles: create post modal, publish post (API-first), story creation,
 * post menu, delete, sidebar, stories scroll, dashboard nav.
 *
 * NOTE: comment / share / react / follow are handled by social-features.js
 * and realtime-updates.js which load AFTER this file.
 * socialToast() is therefore NOT available here at definition time —
 * we call it via a safe wrapper that delays until it exists.
 */

'use strict';

// ─── Safe toast (works even before social-features.js loads) ─────────────────
function _feedToast(msg, type) {
    // social-features.js defines socialToast and loads after us.
    // By the time the user triggers any action, all scripts are loaded.
    if (typeof socialToast === 'function') { socialToast(msg, type); return; }
    // Fallback: queue for next tick in case we're called during DOMContentLoaded
    setTimeout(() => {
        if (typeof socialToast === 'function') socialToast(msg, type);
    }, 50);
}

// ─── Tiny escape helper ───────────────────────────────────────────────────────
function _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function _timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7)  return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

function _currentUsername() {
    try { return JSON.parse(localStorage.getItem('pageUser') || '{}').username || 'You'; }
    catch { return 'You'; }
}

function _currentUserId() {
    try { return String(JSON.parse(localStorage.getItem('pageUser') || '{}').id || ''); }
    catch { return ''; }
}

/** Minimal author object for optimistic cards, using the cached profile. */
function _currentAuthor() {
    try {
        const u = JSON.parse(localStorage.getItem('pageUser') || '{}');
        const username = u.username || 'You';
        return {
            id:                u.id,
            username,
            display_name:      u.display_name || username,
            profile_image_url: u.profile_image_url || u.profile_image || null,
        };
    } catch {
        return { id: '', username: 'You', display_name: 'You', profile_image_url: null };
    }
}

/** True when a post payload was authored by the signed-in user. */
function _isSelfAuthored(post) {
    const me = _currentUserId();
    if (!me) return false;
    const authorId = post?.author?.id ?? post?.author_id ?? '';
    return String(authorId) === me;
}

// ─── Shared de-dup registry with the realtime layer ──────────────────────────
// realtime-updates.js owns `_seenPostIds` and skips ids already in it. We
// register ids here too, so a post is rendered exactly once — whether it
// arrives from the upload response or the Redis WebSocket echo.
const _localSeenPostIds = new Set();
function _markPostSeen(id) {
    if (id == null || id === '') return;
    const key = String(id);
    try {
        if (typeof _seenPostIds !== 'undefined' && _seenPostIds) { _seenPostIds.add(key); return; }
    } catch (_) { /* realtime layer not initialised yet */ }
    _localSeenPostIds.add(key);
}

// ─── Upload-in-flight counter ────────────────────────────────────────────────
// While the current user's post is uploading, the Redis echo of that same post
// must be ignored — the upload flow already renders it optimistically.
let _selfUploadsInFlight = 0;
function _socialUploadStarted() { _selfUploadsInFlight += 1; }
function _socialUploadSettled() { _selfUploadsInFlight = Math.max(0, _selfUploadsInFlight - 1); }
// Works for both posts and stories — both expose `author.id`.
function _socialEchoSuppressed(item) {
    return _selfUploadsInFlight > 0 && _isSelfAuthored(item);
}

// ─── Story de-dup registry (same idea as posts) ──────────────────────────────
// The stories rail is keyed by `data-story-id`; this set additionally lets the
// realtime layer skip the Redis echo of a story the user just uploaded.
const _localSeenStoryIds = new Set();
function _markStorySeen(id) {
    if (id == null || id === '') return;
    _localSeenStoryIds.add(String(id));
}
function _storySeen(id) {
    return _localSeenStoryIds.has(String(id));
}

// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD NAV
// ─────────────────────────────────────────────────────────────────────────────
function toggleDashboardMenu() {
    const d = document.getElementById('dashboardDropdown');
    if (d) d.classList.toggle('show');
}

window.addEventListener('click', e => {
    if (!e.target.matches('.btn-dashboard-toggle') && !e.target.closest('.btn-dashboard-toggle')) {
        document.querySelectorAll('.dashboard-dropdown-content.show')
            .forEach(el => el.classList.remove('show'));
    }
});

function showDashboardView() {
    document.getElementById('social-feed')?.classList.remove('active');
    document.getElementById('dashboard')?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'dashboard');
    });
}

function scrollToSection(id) {
    showDashboardView();
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE RECORDING (inline, "What's on your mind" bar)
// ─────────────────────────────────────────────────────────────────────────────
let _voiceMediaRecorder = null;
let _voiceChunks        = [];
let _voiceBlob          = null;
let _voiceTimerInterval = null;
let _voiceSeconds       = 0;
let _voiceIsRecording   = false;
let _voiceDiscarding    = false;   // guard: ignore onstop when discarding
let _voiceAudioCtx      = null;    // Web Audio context for live waveform
let _voiceAnalyser      = null;    // AnalyserNode reading mic levels
let _voiceAnimFrame     = null;    // requestAnimationFrame handle

function toggleVoiceRecording(e) {
    e.stopPropagation();
    _voiceIsRecording ? _stopVoiceRecording() : _startVoiceRecording();
}

function _getBestMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function _startVoiceRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
        _feedToast('Microphone not supported in this browser.', 'error');
        return;
    }

    // Build AudioContext synchronously during the user-gesture event so iOS
    // Safari doesn't block it after the async getUserMedia call below.
    try {
        if (!_voiceAudioCtx || _voiceAudioCtx.state === 'closed') {
            _voiceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    } catch (_) { _voiceAudioCtx = null; }

    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then(async stream => {
            _voiceChunks      = [];
            _voiceBlob        = null;
            _voiceIsRecording = true;
            _voiceDiscarding  = false;

            const mimeType = _getBestMimeType();
            _voiceMediaRecorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            _voiceMediaRecorder.ondataavailable = ev => {
                if (ev.data && ev.data.size > 0) _voiceChunks.push(ev.data);
            };

            _voiceMediaRecorder.onstop = () => {
                // Stop all mic tracks and clean up Web Audio
                stream.getTracks().forEach(t => t.stop());
                _voiceStopWaveform();

                // If the user hit Discard, don't show the preview
                if (_voiceDiscarding) return;

                if (!_voiceChunks.length) {
                    _feedToast('No audio captured — check your microphone.', 'error');
                    _resetVoiceUI();
                    return;
                }

                if (_voiceSeconds < 1) {
                    _feedToast('Hold the button a moment longer to record.', 'info');
                    _resetVoiceUI();
                    return;
                }

                const usedMime = _voiceMediaRecorder.mimeType || mimeType || 'audio/webm';
                _voiceBlob = new Blob(_voiceChunks, { type: usedMime });

                const url = URL.createObjectURL(_voiceBlob);
                const player = document.getElementById('voicePreviewPlayer');
                if (player) {
                    if (player._prevUrl) URL.revokeObjectURL(player._prevUrl);
                    player._prevUrl      = url;
                    player.src           = url;
                    player.style.display = 'block';
                }

                // Hide live waveform canvas, show "ready" state
                const canvas = document.getElementById('voiceWaveCanvas');
                if (canvas) canvas.style.display = 'none';
                const dot   = document.getElementById('voiceRecDot');
                const label = document.getElementById('voiceRecLabel');
                if (dot)   dot.style.display = 'none';
                if (label) {
                    const m = Math.floor(_voiceSeconds / 60);
                    const s = String(_voiceSeconds % 60).padStart(2, '0');
                    label.textContent = `Voice message ready (${m}:${s})`;
                }
                // Show the caption input now that recording is done
                const captionInput = document.getElementById('voiceCaption');
                if (captionInput) {
                    captionInput.style.display = 'block';
                    captionInput.value = '';
                    captionInput.focus();
                }
                document.getElementById('voicePostBtn').style.display = 'inline-flex';
            };

            // Collect chunks every 250 ms so audio data isn't lost on short recordings
            _voiceMediaRecorder.start(250);

            // ── Wire up Web Audio for real-time waveform ──────────────────
            try {
                if (_voiceAudioCtx) {
                    if (_voiceAudioCtx.state === 'suspended') await _voiceAudioCtx.resume();
                    const source   = _voiceAudioCtx.createMediaStreamSource(stream);
                    _voiceAnalyser = _voiceAudioCtx.createAnalyser();
                    _voiceAnalyser.fftSize               = 128;
                    _voiceAnalyser.smoothingTimeConstant = 0.65;
                    source.connect(_voiceAnalyser);
                }
            } catch (audioErr) {
                console.warn('Voice waveform AudioContext failed:', audioErr.message);
                _voiceAnalyser = null;
            }

            // Show live waveform canvas and kick off animation
            const canvas = document.getElementById('voiceWaveCanvas');
            if (canvas) canvas.style.display = 'block';
            _voiceDrawWaveform();

            // Timer (1 s resolution is fine for display)
            _voiceSeconds = 0;
            _voiceTimerInterval = setInterval(() => {
                _voiceSeconds++;
                const m  = Math.floor(_voiceSeconds / 60);
                const s  = String(_voiceSeconds % 60).padStart(2, '0');
                const el = document.getElementById('voiceRecTimer');
                if (el) el.textContent = `${m}:${s}`;
            }, 1000);

            // Update mic button to stop icon
            const btn  = document.getElementById('voiceRecordBtn');
            const icon = document.getElementById('voiceRecordIcon');
            if (btn)  btn.classList.add('recording');
            if (icon) { icon.classList.remove('fa-microphone'); icon.classList.add('fa-stop'); }

            document.getElementById('voiceRecordingBar').style.display = 'flex';
        })
        .catch(err => {
            console.error('Voice recording error:', err);
            if (_voiceAudioCtx) { _voiceAudioCtx.close().catch(() => {}); _voiceAudioCtx = null; }
            const msg = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
                ? 'Microphone access denied. Allow it in your browser settings and try again.'
                : 'Microphone unavailable. Please check your device and try again.';
            _feedToast(msg, 'error');
        });
}

/** Draw real-time microphone waveform onto the canvas during recording. */
function _voiceDrawWaveform() {
    const canvas = document.getElementById('voiceWaveCanvas');
    if (!canvas) return;

    const ctx      = canvas.getContext('2d');
    const W        = canvas.offsetWidth  || 120;
    const H        = canvas.offsetHeight || 32;
    canvas.width   = W;
    canvas.height  = H;

    const BAR_COUNT = 22;
    const BAR_GAP   = 2;
    const BAR_W     = Math.floor((W - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT);
    const CLR_HI    = '#ef4444';
    const CLR_LO    = 'rgba(239,68,68,0.3)';

    function draw() {
        if (!_voiceMediaRecorder || _voiceMediaRecorder.state === 'inactive') return;
        _voiceAnimFrame = requestAnimationFrame(draw);
        ctx.clearRect(0, 0, W, H);

        let levels;
        if (_voiceAnalyser) {
            const data = new Uint8Array(_voiceAnalyser.frequencyBinCount);
            _voiceAnalyser.getByteFrequencyData(data);
            const voiceBins = Math.floor(data.length * 0.6);
            levels = Array.from({ length: BAR_COUNT }, (_, i) => {
                const start = Math.floor(i * voiceBins / BAR_COUNT);
                const end   = Math.floor((i + 1) * voiceBins / BAR_COUNT);
                let sum = 0;
                for (let j = start; j < end; j++) sum += data[j];
                return sum / Math.max(end - start, 1);
            });
        } else {
            // Fallback: animated random bars if AudioContext unavailable
            levels = Array.from({ length: BAR_COUNT }, () => Math.random() * 180 + 20);
        }

        levels.forEach((level, i) => {
            const barH = Math.max(3, (level / 255) * (H - 4));
            const x    = i * (BAR_W + BAR_GAP);
            const y    = (H - barH) / 2;
            ctx.fillStyle = level > 80 ? CLR_HI : CLR_LO;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, BAR_W, barH, 2);
            else ctx.rect(x, y, BAR_W, barH);
            ctx.fill();
        });
    }

    draw();
}

/** Stop the waveform animation and release AudioContext resources. */
function _voiceStopWaveform() {
    if (_voiceAnimFrame) {
        cancelAnimationFrame(_voiceAnimFrame);
        _voiceAnimFrame = null;
    }
    if (_voiceAudioCtx) {
        _voiceAudioCtx.close().catch(() => {});
        _voiceAudioCtx = null;
        _voiceAnalyser = null;
    }
    // Clear canvas
    const canvas = document.getElementById('voiceWaveCanvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function _stopVoiceRecording() {
    _voiceIsRecording = false;
    clearInterval(_voiceTimerInterval);
    if (_voiceMediaRecorder && _voiceMediaRecorder.state !== 'inactive') {
        _voiceMediaRecorder.stop();   // triggers onstop → shows preview
    }
    const btn  = document.getElementById('voiceRecordBtn');
    const icon = document.getElementById('voiceRecordIcon');
    if (btn)  btn.classList.remove('recording');
    if (icon) { icon.classList.remove('fa-stop'); icon.classList.add('fa-microphone'); }
}

function _resetVoiceUI() {
    _voiceStopWaveform();

    const bar    = document.getElementById('voiceRecordingBar');
    const player = document.getElementById('voicePreviewPlayer');
    const btn    = document.getElementById('voiceRecordBtn');
    const icon   = document.getElementById('voiceRecordIcon');
    const dot    = document.getElementById('voiceRecDot');
    const label  = document.getElementById('voiceRecLabel');
    const canvas = document.getElementById('voiceWaveCanvas');

    if (player?._prevUrl) { URL.revokeObjectURL(player._prevUrl); player._prevUrl = null; }
    if (bar)    bar.style.display    = 'none';
    if (player) { player.src = ''; player.style.display = 'none'; }
    if (btn)    btn.classList.remove('recording');
    if (icon)   { icon.classList.remove('fa-stop'); icon.classList.add('fa-microphone'); }
    if (dot)    { dot.style.display = ''; }
    if (label)  label.innerHTML = 'Recording\u2026 <span id="voiceRecTimer">0:00</span>';
    if (canvas) canvas.style.display = 'none';
    const postBtn = document.getElementById('voicePostBtn');
    if (postBtn) postBtn.style.display = 'none';
    const captionInput = document.getElementById('voiceCaption');
    if (captionInput) { captionInput.style.display = 'none'; captionInput.value = ''; }
}

function discardVoiceRecording() {
    _voiceIsRecording = false;
    _voiceDiscarding  = true;
    clearInterval(_voiceTimerInterval);

    if (_voiceMediaRecorder && _voiceMediaRecorder.state !== 'inactive') {
        _voiceMediaRecorder.stop();
    }

    _voiceBlob   = null;
    _voiceChunks = [];
    _voiceStopWaveform();
    _resetVoiceUI();
}

function postVoiceRecording() {
    if (!_voiceBlob) return;

    const token   = localStorage.getItem('djangoAuthToken');
    const caption = (document.getElementById('voiceCaption')?.value || '').trim();
    if (!token) {
        _feedToast('Sign in to post a voice message.', 'error');
        return;
    }

    // Capture duration BEFORE we reset state
    const durationSecs = _voiceSeconds;
    const m = Math.floor(durationSecs / 60);
    const s = String(durationSecs % 60).padStart(2, '0');
    const durLabel = `${m}:${s}`;

    // Build a File from the blob
    const ext  = _voiceBlob.type.includes('mp4') ? 'm4a'
               : _voiceBlob.type.includes('ogg') ? 'ogg'
               : 'webm';
    const blobCopy = _voiceBlob;   // hold reference before clearing
    const file = new File([blobCopy], `voice-${Date.now()}.${ext}`, { type: blobCopy.type });

    // Optimistic local card (object URL — swapped for the server URL on success)
    const localUrl = URL.createObjectURL(blobCopy);
    const tempId   = `local-voice-${Date.now()}`;
    const card = _insertPostCard({
        id:             tempId,
        content:        caption,
        post_type:      'voice',
        _voiceUrl:      localUrl,
        _voiceDur:      durLabel,
        author:         _currentAuthor(),
        created_at:     new Date().toISOString(),
        reaction_count: 0, comment_count: 0, share_count: 0,
    });

    // Clean up recording state
    _voiceBlob       = null;
    _voiceChunks     = [];
    _voiceDiscarding = true;
    clearInterval(_voiceTimerInterval);
    if (_voiceMediaRecorder && _voiceMediaRecorder.state !== 'inactive') _voiceMediaRecorder.stop();
    _resetVoiceUI();

    const buildForm = () => {
        const fd = new FormData();
        fd.append('post_type',      'voice');
        fd.append('content',        caption);
        fd.append('voice_file',     file, file.name);
        fd.append('voice_duration', String(durationSecs));
        return fd;
    };

    const attempt = () => {
        _socialUploadStarted();
        _setPostCardUploadState(card, 'uploading', 0);
        _uploadForm(_POST_API, buildForm(), token, {
            onProgress: pct => _setPostCardUploadState(card, 'uploading', pct),
            onDone: apiPost => {
                _socialUploadSettled();
                _finalizePostCard(card, apiPost, localUrl);
                _feedToast('Voice message posted! 🎤', 'success');
            },
            onError: err => {
                _socialUploadSettled();
                console.error('Voice post failed:', err);
                const msg = err?.error || err?.detail || 'Upload failed — tap Retry.';
                _setPostCardUploadState(card, 'error', 0, msg, attempt);
                _feedToast('Voice upload failed — tap Retry to try again.', 'error');
            },
        });
    };

    _feedToast('Posting voice message… 🎤', 'info');
    attempt();
}

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE POST MODAL
// ─────────────────────────────────────────────────────────────────────────────
let _selectedMedia     = null;
let _selectedMediaType = null;

function openCreatePostModal(type = null) {
    const modal = document.getElementById('createPostModal');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('modal--open'));

    // Populate creator name from loaded user
    const name = document.getElementById('userMenuName')?.textContent
              || document.getElementById('sidebarUsername')?.textContent
              || _currentUsername();
    const nameEl = document.getElementById('postCreatorName');
    if (nameEl) nameEl.textContent = name;

    // Stamp the current user's avatar in the modal each time it opens
    try {
        const u = JSON.parse(localStorage.getItem('pageUser') || '{}');
        const url = u.profile_image_url || u.avatar_url || u.profile_image || null;
        if (window._stampCurrentUserAvatar) {
            window._stampCurrentUserAvatar(url, u.username || name);
        }
    } catch (_) { /* non-critical */ }

    if (type === 'photo')       triggerMediaUpload('image');
    else if (type === 'video')  triggerMediaUpload('video');
    else if (type === 'achievement') addAchievement();
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (!modal) return;
    modal.classList.remove('modal--open');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
    const ta = document.getElementById('postContent');
    if (ta) ta.value = '';
    removePostMedia();
}

function triggerMediaUpload(type) {
    const input = document.getElementById('mediaUploadInput');
    if (!input) return;
    input.accept   = type === 'image' ? 'image/*' : 'video/*';
    // The backend stores a single media_file per post — allow one file at a time
    input.multiple = false;
    input.value    = ''; // allow re-selecting the same file
    input.click();
}

function handleMediaUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return;

    const preview = document.getElementById('postMediaPreview');
    const content = document.getElementById('mediaPreviewContent');
    if (!content) return;

    // Keep upload state in sync with the single selected file
    _selectedMedia     = file;
    _selectedMediaType = isVideo ? 'video' : 'image';

    const reader = new FileReader();
    reader.onload = e => {
        content.innerHTML = isVideo
            ? `<div class="media-preview-item video-preview">
                    <video src="${e.target.result}" controls></video>
                    <button class="remove-media-btn" onclick="removePostMedia()">
                        <i class="fas fa-times"></i></button></div>`
            : `<div class="media-preview-item">
                    <img src="${e.target.result}" alt="Preview">
                    <button class="remove-media-btn" onclick="removePostMedia()">
                        <i class="fas fa-times"></i></button></div>`;
    };
    reader.readAsDataURL(file);

    if (preview) preview.style.display = 'block';
}

function removePostMedia() {
    _selectedMedia = _selectedMediaType = null;
    const preview = document.getElementById('postMediaPreview');
    const content = document.getElementById('mediaPreviewContent');
    const input   = document.getElementById('mediaUploadInput');
    if (preview) preview.style.display = 'none';
    if (content) content.innerHTML     = '';
    if (input)   input.value           = '';
}

function addAchievement() {
    _selectedMediaType = 'achievement';
    const content = document.getElementById('mediaPreviewContent');
    const preview = document.getElementById('postMediaPreview');
    if (content) content.innerHTML = `
        <div class="achievement-badge-large">
            <i class="fas fa-trophy"></i>
            <h3>Achievement Unlocked!</h3>
            <p>Share your success</p>
        </div>`;
    if (preview) preview.style.display = 'block';
}

function addLocation() {
    const ta = document.getElementById('postContent');
    if (!ta) return;
    ta.value = (ta.value ? ta.value + '\n' : '') + '📍 My Location';
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLISH POST  (multipart/form-data — supports media + voice file uploads)
// ─────────────────────────────────────────────────────────────────────────────
const _POST_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api/social/posts/'
    : `${window.location.origin}/api/social/posts/`;

function publishPost() {
    const content = (document.getElementById('postContent')?.value || '').trim();
    const isAchievement = _selectedMediaType === 'achievement';

    if (!content && !_selectedMedia && !isAchievement) {
        _feedToast('Add some text or media before posting.', 'info');
        return;
    }

    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { _feedToast('Sign in to publish a post.', 'error'); return; }

    const btn = document.querySelector('#createPostModal .btn-post');

    // Snapshot the composer state before we reset the modal
    const mediaFile = (!isAchievement && _selectedMedia) ? _selectedMedia : null;
    const mediaType = mediaFile ? (_selectedMediaType === 'video' ? 'video' : 'image') : null;
    const post_type = isAchievement ? 'achievement' : mediaFile ? 'media' : 'text';

    // Object URL gives the user an instant preview while the file uploads
    let localUrl = null;
    const localMedia = [];
    if (mediaFile) {
        localUrl = URL.createObjectURL(mediaFile);
        localMedia.push({ type: mediaType, src: localUrl });
    } else if (isAchievement) {
        localMedia.push({ type: 'achievement' });   // no object URL — kept after finalise
    }

    // 1. Render the post immediately so the user gets instant feedback
    const tempId = `local-post-${Date.now()}`;
    const card = _insertPostCard({
        id: tempId,
        content,
        post_type,
        media_type: mediaType,
        _localMedia: localMedia,
        author:      _currentAuthor(),
        created_at:     new Date().toISOString(),
        reaction_count: 0, comment_count: 0, share_count: 0,
    });

    // 2. Close the composer straight away — no waiting on the network
    closeCreatePostModal();
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post'; }

    const buildForm = () => {
        const fd = new FormData();
        fd.append('content',   content);
        fd.append('post_type', post_type);
        // 'privacy' is intentionally omitted — not a model field yet
        if (mediaFile) {
            fd.append('media_file', mediaFile, mediaFile.name);
            fd.append('media_type', mediaType);
        }
        return fd;
    };

    // 3. Upload with live progress; keep the card and offer Retry on failure
    const attempt = () => {
        _socialUploadStarted();
        _setPostCardUploadState(card, 'uploading', 0);
        _uploadForm(_POST_API, buildForm(), token, {
            onProgress: pct => _setPostCardUploadState(card, 'uploading', pct),
            onDone: apiPost => {
                _socialUploadSettled();
                _finalizePostCard(card, apiPost, localUrl, isAchievement ? localMedia : null);
                _feedToast(isAchievement ? 'Achievement shared! 🏆' : 'Post published! 🎉', 'success');
            },
            onError: err => {
                _socialUploadSettled();
                console.error('publishPost API failed:', err);
                const msg = err?.error || err?.detail
                    || (typeof err === 'string' && err !== 'no_token' ? err : '')
                    || 'Could not publish post — please try again.';
                _setPostCardUploadState(card, 'error', 0, msg, attempt);
                _feedToast('Upload failed — tap Retry on the post to try again.', 'error');
            },
        });
    };
    attempt();
}

/**
 * POST a multipart FormData with upload progress.
 * Uses XHR because fetch() cannot report upload progress.
 * Works for any endpoint — posts, voice notes, stories.
 */
function _uploadForm(url, formData, token, { onProgress, onDone, onError }) {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', `Token ${token}`);
    xhr.timeout = 120000;

    xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
        }
    };
    xhr.onload = () => {
        let body = null;
        try { body = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON body */ }
        if (xhr.status >= 200 && xhr.status < 300) {
            onDone?.(body);
        } else {
            onError?.(body || { error: `Upload failed (${xhr.status}).` });
        }
    };
    xhr.onerror   = () => onError?.({ error: 'Network error — check your connection and try again.' });
    xhr.ontimeout = () => onError?.({ error: 'Upload timed out. Please try again.' });
    xhr.send(formData);
    return xhr;
}

/**
 * Show a small status strip on an optimistic post card.
 * @param {HTMLElement} card
 * @param {'uploading'|'error'|'done'} state
 * @param {number}  pct      upload percentage (0–100)
 * @param {string}  msg      error message
 * @param {Function} onRetry retry handler for the error state
 */
function _setPostCardUploadState(card, state, pct = 0, msg = '', onRetry = null) {
    if (!card || !card.isConnected) return;

    if (state === 'done') {
        card.querySelector('.post-upload-status')?.remove();
        return;
    }

    let bar = card.querySelector('.post-upload-status');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'post-upload-status';
        bar.style.cssText = 'margin:8px 16px 0;font-size:12px;color:#666;'
            + 'display:flex;align-items:center;gap:8px;';
        card.appendChild(bar);
    }

    if (state === 'uploading') {
        const label = pct > 0 && pct < 100 ? `Uploading… ${pct}%` : 'Uploading…';
        bar.innerHTML = `<i class="fas fa-circle-notch fa-spin" style="color:#6c63ff;"></i>`
            + `<span>${label}</span>`;
        return;
    }

    // error
    bar.innerHTML = `<i class="fas fa-triangle-exclamation" style="color:#e63946;"></i>`
        + `<span style="color:#e63946;">${_esc(msg || 'Upload failed.')}</span>`;
    if (typeof onRetry === 'function') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.style.cssText = 'margin-left:auto;padding:3px 12px;border:1px solid #6c63ff;'
            + 'background:#fff;color:#6c63ff;border-radius:14px;font-size:12px;cursor:pointer;';
        retry.onclick = () => { bar.remove(); onRetry(); };
        bar.appendChild(retry);
    }
}

/**
 * Swap an optimistic card for the server-confirmed post.
 * Marks the id as seen so the Redis echo of the same post is ignored.
 *
 * @param {HTMLElement} tempCard        the optimistic card
 * @param {object}      apiPost         server response payload
 * @param {string}      localUrl        object URL to revoke (media posts)
 * @param {Array}       overrideMedia   optional visible-media array to carry over
 */
function _finalizePostCard(tempCard, apiPost, localUrl, overrideMedia = null) {
    if (!apiPost || apiPost.id == null) return;

    const realId = String(apiPost.id);
    _markPostSeen(realId);

    // The WebSocket echo may have rendered the canonical card already —
    // keep that one and drop our optimistic duplicate.
    const existing = document.querySelector(`[data-post-id="${realId}"]`);
    if (existing && existing !== tempCard) {
        if (tempCard?.isConnected) tempCard.remove();
        // Only revoke object URL once we're done with it
        if (localUrl) URL.revokeObjectURL(localUrl);
        return;
    }

    // Resolve the server media URL before building the card so the browser
    // can load it (backend returns relative /media/... paths).
    const serverMediaUrl = (typeof resolveMediaUrl === 'function')
        ? resolveMediaUrl(apiPost.resolved_media_url || apiPost.media_url || null)
        : (apiPost.resolved_media_url || apiPost.media_url || null);

    const payload = {
        ...(overrideMedia && overrideMedia.length
            ? { ...apiPost, _localMedia: overrideMedia }
            : apiPost),
        // Carry the resolved server URL so voice/video renders correctly
        resolved_media_url: serverMediaUrl || apiPost.resolved_media_url || apiPost.media_url || null,
    };

    const fresh = _buildPostCardEl(payload);
    fresh.classList.add('post-card--new');

    if (tempCard?.isConnected) tempCard.replaceWith(fresh);
    else _insertPostCard(payload);

    // Revoke object URL only after the new card is in the DOM
    if (localUrl) URL.revokeObjectURL(localUrl);
}

/** Prepend a post card to the feed. Returns the created element (or null). */
function _insertPostCard(post) {
    const container = document.getElementById('feedPosts');
    if (!container) return null;
    const card = _buildPostCardEl(post);
    container.insertBefore(card, container.firstChild);
    return card;
}

/** Build a post card element from a post payload (does not insert it). */
function _buildPostCardEl(post) {
    const author = post.author || {};
    const name   = _esc(author.display_name || author.username || _currentUsername());
    const media  = post._localMedia || post.media || [];
    const when   = post.created_at ? _timeAgo(post.created_at) : 'Just now';

    const avatarHTML_str = (typeof avatarHTML === 'function')
        ? avatarHTML(author)
        : (() => {
            const raw = author.profile_image_url || author.avatar_url || author.profile_image || null;
            const url = raw ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(raw) : raw) : null;
            const init = (author.display_name || author.username || '?').charAt(0).toUpperCase();
            return url
                ? `<img src="${_esc(url)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"
                       onerror="this.replaceWith(window.pageLetterAvatar('${init}'))">`
                : (window.pageLetterAvatarHTML ? window.pageLetterAvatarHTML(init) : `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#6c63ff;color:#fff;font-weight:700;font-size:14px;">${init}</span>`);
        })();

    let mediaHTML = '';
    if (post._voiceUrl || (post.post_type === 'voice' && (post.resolved_media_url || post.media_url))) {
        const voiceSrc = post._voiceUrl
            || ((typeof resolveMediaUrl === 'function')
                ? resolveMediaUrl(post.resolved_media_url || post.media_url)
                : (post.resolved_media_url || post.media_url));
        const dur      = post._voiceDur
            || (post.voice_duration ? `${Math.floor(post.voice_duration/60)}:${String(post.voice_duration%60).padStart(2,'0')}` : '');
        mediaHTML = `<div class="post-media">
            <audio class="voice-note-player" controls preload="metadata" src="${_esc(voiceSrc)}"
                   style="width:100%;border-radius:8px;margin-top:4px;"></audio>
            <span style="font-size:12px;color:#888;display:block;margin-top:4px;"><i class="fas fa-microphone"></i> Voice message${dur ? ' · ' + _esc(dur) : ''}</span>
        </div>`;
    } else if (media[0]?.type === 'achievement') {
        mediaHTML = `<div class="post-media"><div class="achievement-badge-large">
            <i class="fas fa-trophy"></i><h3>Achievement Unlocked!</h3>
            <p>Shared your success</p></div></div>`;
    } else if (media.length) {
        mediaHTML = '<div class="post-media"><div class="post-media-grid">';
        media.forEach((m, i) => {
            if (m.type === 'image')
                mediaHTML += `<div class="post-media-item"><img src="${_esc(m.src)}" alt="Post image ${i+1}" loading="lazy"></div>`;
            else if (m.type === 'video')
                mediaHTML += `<div class="post-media-item video-item"><video src="${_esc(m.src)}" controls preload="metadata" playsinline style="width:100%;border-radius:8px;"></video></div>`;
        });
        mediaHTML += '</div></div>';
    } else if (post.media_url || post.resolved_media_url) {
        const rawSrc = post.resolved_media_url || post.media_url;
        const src = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(rawSrc) : rawSrc;
        mediaHTML = (post.media_type === 'video')
            ? `<div class="post-media"><video src="${_esc(src)}" controls preload="metadata" playsinline style="width:100%;border-radius:8px;max-height:420px;"></video></div>`
            : (post.media_type === 'audio')
                ? `<div class="post-media"><audio src="${_esc(src)}" controls preload="metadata" style="width:100%;border-radius:8px;margin-top:4px;"></audio></div>`
                : `<div class="post-media"><img src="${_esc(src)}" alt="Post media" loading="lazy"></div>`;
    }

    const card = document.createElement('div');
    card.className = 'post-card post-card--new';
    card.setAttribute('data-post-id', post.id);
    card.setAttribute('data-author-id', String(author.id || ''));
    card.innerHTML = `
        <div class="post-header">
            <div class="post-author">
                <div class="post-avatar">${avatarHTML_str}</div>
                <div class="post-author-info">
                    <h4>${name}</h4>
                    <span class="post-time">${when}</span>
                </div>
            </div>
            <button class="post-menu-btn" onclick="showPostMenu('${post.id}', event)">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
        <div class="post-content"><p>${_esc(post.content)}</p></div>
        ${mediaHTML}
        <div class="post-stats">
            <span><i class="fas fa-fire"></i>
                <span class="reaction-count">${post.reaction_count ?? 0}</span> reactions</span>
            <span><span class="comment-count">${post.comment_count ?? 0}</span> comments
                · <span class="share-count">${post.share_count ?? 0}</span> shares</span>
        </div>
        <div class="post-actions">
            <button class="post-action-btn reaction-btn${post.user_reaction ? ' reacted' : ''}"
                data-post-id="${post.id}"
                data-active-reaction="${post.user_reaction || ''}">
                <i class="fas fa-fire"></i><span>React</span>
            </button>
            <button class="post-action-btn" onclick="openCommentModal('${post.id}')">
                <i class="fas fa-comment"></i><span>Comment</span>
            </button>
            <button class="post-action-btn" onclick="openShareModal('${post.id}')">
                <i class="fas fa-share"></i><span>Share</span>
            </button>
        </div>
        <div class="post-comments"></div>`;

    return card;
}

// Sync any created posts saved in localStorage by fetching them from the API
async function _syncCreatedPosts() {
    // No-op — posts are now always persisted via the API, never localStorage.
    // Kept as a stub so any existing references don't throw.
}

document.addEventListener('DOMContentLoaded', _syncCreatedPosts);

function _saveLocalPost(_post) {
    // No-op — localStorage post saving removed. Posts persist via Django API.
}

/** Load any locally-saved posts on startup */
function _loadLocalPosts() {
    // No-op — localStorage post saving removed. loadRealFeed() handles everything.
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST MENU (⋯ dropdown)
// ─────────────────────────────────────────────────────────────────────────────
function showPostMenu(postId, event) {
    // Remove any existing menu
    document.querySelectorAll('.post-menu-dropdown').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'post-menu-dropdown';
    menu.innerHTML = `
        <button onclick="deletePost('${postId}')">
            <i class="fas fa-trash"></i> Delete Post
        </button>
        <button onclick="copyPostLink('${postId}')">
            <i class="fas fa-link"></i> Copy Link
        </button>`;

    const btn  = event?.target?.closest('.post-menu-btn');
    const rect = btn?.getBoundingClientRect();
    if (rect) {
        menu.style.cssText = `position:fixed;top:${rect.bottom + 6}px;
            right:${window.innerWidth - rect.right}px;z-index:1200`;
    }
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', function close(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
        });
    }, 50);
}

function deletePost(postId) {
    if (!confirm('Delete this post?')) return;

    const token = localStorage.getItem('djangoAuthToken');
    const API   = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
    if (token) {
        fetch(`${API}/social/posts/${postId}/`, {
            method:  'DELETE',
            headers: { 'Authorization': `Token ${token}` }
        }).catch(() => {});
    }

    const card = document.querySelector(`[data-post-id="${postId}"]`);
    if (card) {
        card.style.transition = 'opacity .3s, transform .3s';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(.97)';
        setTimeout(() => card.remove(), 300);
    }
    _feedToast('Post deleted.', 'info');
}

function copyPostLink(postId) {
    const url = `${window.location.origin}/posts/${postId}`;
    navigator.clipboard?.writeText(url)
        .then(() => _feedToast('Link copied! 🔗', 'success'))
        .catch(()  => _feedToast('Could not copy link.', 'error'));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function updateSocialSidebar() {
    try {
        const user = JSON.parse(localStorage.getItem('pageUser') || '{}');
        const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('sidebarUsername', user.username || 'Player');
        set('sidebarTier',     (user.access_tier || 'Bronze') + ' Tier');
        set('sidebarPrestige', user.prestige_points ?? 0);
    } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  STORY CREATION
// ─────────────────────────────────────────────────────────────────────────────
function openCreateStoryModal() { createStory(); }

const _STORY_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api/social/stories/'
    : `${window.location.origin}/api/social/stories/`;

function createStory() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;

        const token = localStorage.getItem('djangoAuthToken');
        if (!token) { _feedToast('Sign in to share a story.', 'error'); return; }

        const isVideo   = file.type.startsWith('video/');
        const mediaType = isVideo ? 'video' : 'image';
        const previewUrl = URL.createObjectURL(file);

        // 1. Optimistic ring in the rail — instant feedback using the local file
        const card = _insertStoryCard({
            id:         `local-story-${Date.now()}`,
            author:     _currentAuthor(),
            media_url:  previewUrl,
            media_type: mediaType,
            content:    '',
            view_count: 0,
            created_at: new Date().toISOString(),
        });

        const buildForm = () => {
            const form = new FormData();
            form.append('media_file', file);
            form.append('media_type', mediaType);
            form.append('content', '');
            return form;
        };

        // 2. Upload — while this is in flight, the Redis echo of our own story
        //    is ignored by the realtime layer (see _socialEchoSuppressed).
        _socialUploadStarted();
        _feedToast('Sharing story…', 'info');
        _uploadForm(_STORY_API, buildForm(), token, {
            onDone: saved => {
                _socialUploadSettled();
                URL.revokeObjectURL(previewUrl);
                _markStorySeen(saved.id);
                // Promote the optimistic ring to the real id so the viewer works
                if (card?.isConnected) {
                    card.dataset.storyId = String(saved.id);
                    card._storyData = [{
                        ...saved,
                        resolved_media_url: saved.resolved_media_url || saved.media_url || previewUrl,
                    }];
                }
                _feedToast('Story shared! 🎉', 'success');
            },
            onError: err => {
                _socialUploadSettled();
                console.error('Story upload failed:', err);
                URL.revokeObjectURL(previewUrl);
                // Nothing was saved server-side — drop the ring so the user is
                // not misled into thinking the story is live.
                if (card?.isConnected) card.remove();
                _feedToast(err?.error || err?.detail || 'Story upload failed — please try again.', 'error');
            },
        });
    };
    input.click();
}

/** Insert a rendered story card into the stories rail. Returns the created element. */
function _insertStoryCard(story) {
    const isVideo  = story.media_type === 'video';
    const mediaUrl = story.resolved_media_url || story.media_url || '';
    const name     = _esc(story.author?.display_name || story.author?.username || 'Story');

    const card = document.createElement('div');
    card.className = 'story-card';
    card.style.animation = 'fadeInCard .4s ease';
    card.dataset.storyId = story.id;

    const imgStyle = (!isVideo && mediaUrl)
        ? `background-image:url('${mediaUrl}');background-size:cover;background-position:center;`
        : (() => {
            // prefer profile_image_url (base64/CDN) over legacy profile_image
            const _authorRaw = story.author?.profile_image_url || story.author?.avatar_url || story.author?.profile_image || null;
            const authorUrl = _authorRaw ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(_authorRaw) : _authorRaw) : null;
            return authorUrl
                ? `background:url('${authorUrl}') center/cover;`
                : 'background:linear-gradient(135deg,#556b2f,#8bc34a);';
        })();

    card.innerHTML = `
        <div class="story-ring-wrap own-story" style="position:relative;">
            <div class="story-image" style="${imgStyle}">
                ${isVideo && mediaUrl ? `<video src="${_esc(mediaUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0;" muted playsinline></video>` : ''}
            </div>
        </div>
        <span class="story-name">${name}</span>`;

    const storyData = [story];
    card._storyData = storyData;
    card.onclick = () => {
        const data = card._storyData || storyData;
        if (window.storyViewer?.openStory) window.storyViewer.openStory(data[0].id, data);
    };

    const container  = document.querySelector('.stories-container');
    const createCard = container?.querySelector('.create-story');
    if (createCard?.nextSibling) container.insertBefore(card, createCard.nextSibling);
    else if (container) container.appendChild(card);

    return card;
}

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE COMPETITION FEED (sidebar animation)
// ─────────────────────────────────────────────────────────────────────────────
function _startLiveFeedTicker() {
    const activities = [
        { user: 'Player123',   action: 'earned 50 pts' },
        { user: 'ProGamer',    action: 'completed a challenge' },
        { user: 'Champion',    action: 'reached Gold Tier' },
        { user: 'ElitePlayer', action: 'won a tournament' },
        { user: 'RisingStar',  action: 'joined an alliance' },
        { user: 'Legend',      action: 'earned 100 pts' }
    ];

    setInterval(() => {
        const feed = document.querySelector('.live-feed');
        if (!feed) return;
        const act  = activities[Math.floor(Math.random() * activities.length)];
        const item = document.createElement('div');
        item.className = 'live-item';
        item.style.animation = 'fadeInCard .4s ease';
        item.innerHTML = `
            <span class="live-dot"></span>
            <div class="live-info">
                <strong>${act.user}</strong> ${act.action}
                <span class="live-time">Just now</span>
            </div>`;
        feed.insertBefore(item, feed.firstChild);
        while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    }, 15_000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  STORIES HORIZONTAL SCROLL
// ─────────────────────────────────────────────────────────────────────────────
function _initStoriesScroll() {
    const container = document.querySelector('.stories-container');
    if (!container) return;

    const update = () => {
        const canScroll = container.scrollWidth > container.clientWidth;
        const atStart   = container.scrollLeft <= 5;
        const atEnd     = container.scrollLeft >= container.scrollWidth - container.clientWidth - 5;
        container.classList.toggle('has-scroll',       canScroll && !atEnd);
        container.classList.toggle('has-scroll-start', canScroll && !atStart);
    };

    container.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    new MutationObserver(update).observe(container, { childList: true });
    update();

    // Drag-to-scroll on desktop
    if (window.innerWidth >= 768) {
        let down = false, startX, scrollLeft, vx = 0, lx = 0, lt = 0;
        container.style.cursor = 'grab';

        container.addEventListener('mousedown',  e => {
            down = true; container.style.cursor = 'grabbing';
            startX = e.pageX - container.offsetLeft;
            scrollLeft = container.scrollLeft;
            vx = 0; lx = e.pageX; lt = Date.now();
        });
        container.addEventListener('mouseleave', () => { down = false; container.style.cursor = 'grab'; });
        container.addEventListener('mouseup',    () => {
            down = false; container.style.cursor = 'grab';
            let m = vx;
            (function glide() {
                m *= 0.94; container.scrollLeft -= m;
                if (Math.abs(m) > 0.5) requestAnimationFrame(glide);
            })();
        });
        container.addEventListener('mousemove', e => {
            if (!down) return; e.preventDefault();
            container.scrollLeft = scrollLeft - (e.pageX - container.offsetLeft - startX) * 1.5;
            const now = Date.now(), dt = now - lt;
            if (dt > 0) vx = (e.pageX - lx) / dt * 16;
            lx = e.pageX; lt = now;
        });
    }

    // Keyboard nav
    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); container.scrollBy({ left: -200, behavior: 'smooth' }); }
        if (e.key === 'ArrowRight') { e.preventDefault(); container.scrollBy({ left:  200, behavior: 'smooth' }); }
    });

    // One-time scroll hint on mobile
    if (window.innerWidth < 768 && !localStorage.getItem('storiesHintShown')) {
        setTimeout(() => {
            container.classList.add('show-hint');
            setTimeout(() => {
                container.classList.remove('show-hint');
                localStorage.setItem('storiesHintShown', '1');
            }, 2000);
        }, 1200);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  REAL-TIME FEED & STORIES LOADER
// ─────────────────────────────────────────────────────────────────────────────

const _SOCIAL_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api/social'
    : `${window.location.origin}/api/social`;

let _feedPage        = 1;
let _feedLoading     = false;
let _feedExhausted   = false;

/**
 * Fetch real posts from the API and render them.
 * Clears the loading spinner on first load.
 */
async function loadRealFeed(page = 1) {
    if (_feedLoading || _feedExhausted) return;
    _feedLoading = true;

    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { _feedLoading = false; return; }

    try {
        const res  = await fetch(`${_SOCIAL_API}/posts/?page=${page}`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();

        const container = document.getElementById('feedPosts');
        if (!container) return;

        // Remove loading spinner on first page
        if (page === 1) {
            const spinner = container.querySelector('.feed-loading');
            if (spinner) spinner.remove();
        }

        const posts = data.results || data;
        if (!posts.length && page === 1) {
            container.innerHTML = `
                <div class="feed-empty">
                    <i class="fas fa-users" style="font-size:48px;opacity:.3;margin-bottom:12px;"></i>
                    <p>No posts yet. Follow people or create your first post!</p>
                </div>`;
            _feedExhausted = true;
            return;
        }

        posts.forEach(post => {
            // Don't duplicate — skip posts already rendered or seen via WebSocket
            if (!container.querySelector(`[data-post-id="${post.id}"]`)) {
                _appendPostCard(post, container);
            }
            _markPostSeen(post.id);   // keep the realtime layer's dedup set in sync
        });

        // Check if more pages exist
        if (!data.next) _feedExhausted = true;
        _feedPage = page + 1;

    } catch (err) {
        console.warn('Feed load error:', err);
        if (page === 1) {
            const container = document.getElementById('feedPosts');
            const spinner = container?.querySelector('.feed-loading');
            if (spinner) spinner.remove();
        }
    } finally {
        _feedLoading = false;
    }
}

/** Append (not prepend) a post card — used for pagination */
function _appendPostCard(post, container) {
    const author = post.author || {};
    const name   = _esc(author.display_name || author.username || 'User');
    const when   = post.created_at ? _timeAgo(post.created_at) : 'Just now';

    const avatarHTML_str = (typeof avatarHTML === 'function')
        ? avatarHTML(author)
        : (() => {
            const raw = author.profile_image_url || author.avatar_url || author.profile_image || null;
            const url = raw ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(raw) : raw) : null;
            const init = (author.display_name || author.username || '?').charAt(0).toUpperCase();
            return url
                ? `<img src="${_esc(url)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"
                       onerror="this.replaceWith(window.pageLetterAvatar('${init}'))">`
                : (window.pageLetterAvatarHTML ? window.pageLetterAvatarHTML(init) : `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#6c63ff;color:#fff;font-weight:700;font-size:14px;">${init}</span>`);
        })();

    // Prefer resolved_media_url (uploaded file) over legacy media_url; resolve relative paths
    const _rawMediaSrc = post.resolved_media_url || post.media_url || null;
    const mediaSrc = _rawMediaSrc
        ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(_rawMediaSrc) : _rawMediaSrc)
        : null;

    let mediaHTML = '';
    if (post.post_type === 'voice' && mediaSrc) {
        const dur = post.voice_duration
            ? ` · ${Math.floor(post.voice_duration / 60)}:${String(post.voice_duration % 60).padStart(2, '0')}`
            : '';
        mediaHTML = `<div class="post-media">
            <audio class="voice-note-player" controls preload="metadata" src="${_esc(mediaSrc)}"
                   style="width:100%;border-radius:8px;margin-top:4px;"></audio>
            <span style="font-size:12px;color:#888;display:block;margin-top:4px;">
                <i class="fas fa-microphone"></i> Voice message${dur}
            </span>
        </div>`;
    } else if (post.media_type === 'audio' && mediaSrc) {
        // Generic audio (e.g. voice stored as media_type='audio')
        mediaHTML = `<div class="post-media">
            <audio controls preload="metadata" src="${_esc(mediaSrc)}"
                   style="width:100%;border-radius:8px;margin-top:4px;"></audio>
        </div>`;
    } else if (mediaSrc && post.media_type === 'video') {
        mediaHTML = `<div class="post-media">
            <video src="${_esc(mediaSrc)}" controls preload="metadata" playsinline
                   style="width:100%;border-radius:8px;max-height:420px;"></video>
        </div>`;
    } else if (mediaSrc) {
        mediaHTML = `<div class="post-media">
            <img src="${_esc(mediaSrc)}" alt="Post media" loading="lazy"></div>`;
    } else if (post.achievement_badge?.title) {
        const ab = post.achievement_badge;
        mediaHTML = `<div class="post-media"><div class="achievement-badge-large">
            <i class="fas fa-trophy"></i>
            <h3>${_esc(ab.title)}</h3>
            <p>${_esc(ab.description || '')}</p>
        </div></div>`;
    }

    const card = document.createElement('div');
    card.className = 'post-card';
    card.setAttribute('data-post-id', post.id);
    card.setAttribute('data-author-id', String(author.id || ''));
    card.innerHTML = `
        <div class="post-header">
            <div class="post-author">
                <div class="post-avatar">${avatarHTML_str}</div>
                <div class="post-author-info">
                    <h4>${name}</h4>
                    <span class="post-time">${when}</span>
                </div>
            </div>
            <button class="post-menu-btn" onclick="showPostMenu('${post.id}', event)">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
        <div class="post-content"><p>${_esc(post.content || '')}</p></div>
        ${mediaHTML}
        <div class="post-stats">
            <span><i class="fas fa-fire"></i>
                <span class="reaction-count">${post.reaction_count ?? 0}</span> reactions</span>
            <span>
                <span class="comment-count">${post.comment_count ?? 0}</span> comments ·
                <span class="share-count">${post.share_count ?? 0}</span> shares
            </span>
        </div>
        <div class="post-actions">
            <button class="post-action-btn reaction-btn${post.user_reaction ? ' reacted' : ''}"
                data-post-id="${post.id}"
                data-active-reaction="${post.user_reaction || ''}">
                <i class="fas fa-fire"></i><span>React</span>
            </button>
            <button class="post-action-btn" onclick="openCommentModal('${post.id}')">
                <i class="fas fa-comment"></i><span>Comment</span>
            </button>
            <button class="post-action-btn" onclick="openShareModal('${post.id}')">
                <i class="fas fa-share"></i><span>Share</span>
            </button>
        </div>
        <div class="post-comments"></div>`;
    container.appendChild(card);
}

/**
 * Fetch real stories from the API and render them in the stories bar.
 * Shows cached stories instantly on reload, then refreshes from API.
 */
const _STORY_CACHE_KEY = 'page_stories_cache';

async function loadRealStories() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return;

    const container = document.querySelector('.stories-container');
    if (!container) return;

    // ── Show cached stories immediately so the bar isn't empty on reload ──
    try {
        const cached = JSON.parse(localStorage.getItem(_STORY_CACHE_KEY) || '[]');
        if (cached.length) _renderStoryCards(cached, container, /*fromCache=*/true);
    } catch (_) { /* corrupt cache — ignore */ }

    try {
        const res = await fetch(`${_SOCIAL_API}/stories/feed/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error(res.status);
        const stories = await res.json();

        // Persist for next reload
        try { localStorage.setItem(_STORY_CACHE_KEY, JSON.stringify(stories)); } catch (_) {}

        _renderStoryCards(stories, container, /*fromCache=*/false);
    } catch (err) {
        console.warn('Stories load error:', err);
    }
}

function _renderStoryCards(stories, container, fromCache) {
    // Remove any existing real story cards (keep the "Add Story" card)
    container.querySelectorAll('.story-card:not(.create-story)').forEach(c => c.remove());

    if (!stories.length) return;

    // Group stories by author
    const byAuthor = {};
    stories.forEach(s => {
        const uid = s.author?.id || s.author?.username;
        if (!byAuthor[uid]) byAuthor[uid] = { author: s.author, stories: [] };
        byAuthor[uid].stories.push(s);
    });

    Object.values(byAuthor).forEach(({ author, stories: authorStories }) => {
        const name   = _esc(author.display_name || author.username || 'User');
        const card   = document.createElement('div');
        card.className = 'story-card flex-shrink-0';

        const latestStory = authorStories[0];
        const mediaSrc    = latestStory.resolved_media_url || latestStory.media_url || null;
        const isVideo     = latestStory.media_type === 'video';

        const _authorRaw2 = author.profile_image_url || author.avatar_url || author.profile_image || null;
        const authorAvatarUrl = _authorRaw2 ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(_authorRaw2) : _authorRaw2) : null;
        const avatarStyle = (mediaSrc && !isVideo)
            ? `background-image:url('${_esc(mediaSrc)}');background-size:cover;background-position:center`
            : (authorAvatarUrl
                ? `background:url('${_esc(authorAvatarUrl)}') center/cover`
                : `background:linear-gradient(135deg,var(--page-primary),var(--page-accent))`);

        const multiCount = authorStories.length > 1
            ? `<span class="story-count-badge">${authorStories.length}</span>` : '';

        card.innerHTML = `
            <div class="story-ring-wrap" title="${name}">
                <div class="story-image" style="${avatarStyle}">
                    ${isVideo && mediaSrc
                        ? `<video src="${_esc(mediaSrc)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;position:absolute;inset:0;" muted playsinline></video>`
                        : ''}
                </div>
                ${multiCount}
            </div>
            <span class="story-name">${name}</span>`;

        card.addEventListener('click', () => {
            if (typeof storyViewer !== 'undefined') {
                storyViewer.openStory(authorStories[0].id, authorStories);
            }
        });

        container.appendChild(card);
    });
}

/** Infinite scroll — load next page when user reaches bottom of feed */
function _initInfiniteScroll() {
    const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !_feedLoading && !_feedExhausted) {
            loadRealFeed(_feedPage);
        }
    }, { rootMargin: '300px' });

    // Sentinel element at the bottom of the feed
    const sentinel = document.createElement('div');
    sentinel.id = 'feedSentinel';
    sentinel.style.height = '1px';
    const feedPosts = document.getElementById('feedPosts');
    if (feedPosts) feedPosts.after(sentinel);
    observer.observe(sentinel);
}
document.addEventListener('DOMContentLoaded', () => {
    // Load real posts and stories from API
    loadRealFeed(1);
    loadRealStories();

    // Sidebar
    setTimeout(updateSocialSidebar, 400);

    // Create-post modal: close on backdrop click
    window.addEventListener('click', e => {
        const modal = document.getElementById('createPostModal');
        if (e.target === modal) closeCreatePostModal();
    });

    // Stories scroll behaviour
    _initStoriesScroll();

    // Live feed ticker (sidebar)
    setTimeout(_startLiveFeedTicker, 5000);

    // Infinite scroll for more posts
    _initInfiniteScroll();
});
