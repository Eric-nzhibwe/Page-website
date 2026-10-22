// Enhanced Challenges — DB-backed, real-time via WebSocket
// All xPoints, votes, comments and answers are persisted to the backend.

let currentChallengeId = null;
let submissionFiles = [];

// ─── API helpers ────────────────────────────────────────────────────────────
const API = '/api/challenges';

// Read token using the same key auth.js writes — 'djangoAuthToken'
function getAuthToken() {
    return localStorage.getItem('djangoAuthToken')
        || localStorage.getItem('authToken')
        || localStorage.getItem('token')
        || '';
}

function isLoggedIn() {
    return !!getAuthToken();
}

function authHeaders() {
    const token = getAuthToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Token ${token}` } : {}),
    };
}

// Redirect to auth page if not logged in, with a message
function requireAuth(action = 'do that') {
    if (isLoggedIn()) return true;
    showNotification(`Please log in to ${action}.`);
    setTimeout(() => { window.location.href = '/pages/auth.html'; }, 1200);
    return false;
}

async function apiGet(url) {
    const r = await fetch(url, { headers: authHeaders() });
    return r.ok ? r.json() : null;
}

async function apiPost(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
}

// ─── xPoints — DB-backed ────────────────────────────────────────────────────
const XPOINTS_EARN_PER_CHALLENGE = 0.5;
const XPOINTS_ENTRY_COST = 1.5;

async function refreshXPoints() {
    const data = await apiGet(`${API}/xpoints/`);
    if (data) renderXPointsBanner(data.balance);
}

function renderXPointsBanner(balance) {
    const el = document.getElementById('xpointsBannerBalance');
    if (el && balance !== undefined) el.textContent = parseFloat(balance).toFixed(1);
}

// Optimistic UI helper — backend handles real deduction
function showNotification(msg) {
    let n = document.getElementById('challengeNotification');
    if (!n) {
        n = document.createElement('div');
        n.id = 'challengeNotification';
        n.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1c1e21;color:#fff;padding:10px 20px;border-radius:20px;z-index:9999;font-size:14px;pointer-events:none;';
        document.body.appendChild(n);
    }
    n.textContent = msg;
    n.style.opacity = '1';
    clearTimeout(n._t);
    n._t = setTimeout(() => { n.style.opacity = '0'; }, 3000);
}
// ────────────────────────────────────────────────────────────────────────────

// Filter challenges
function filterChallenges(filter) {
    const challenges = document.querySelectorAll('.challenge-card');
    const filterBtns = document.querySelectorAll('.challenge-filters .filter-btn');

    // Update active filter
    filterBtns.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    // Filter logic
    challenges.forEach(challenge => {
        const status = challenge.getAttribute('data-status');

        if (filter === 'all') {
            challenge.style.display = 'block';
        } else if (filter === 'active' && status === 'active') {
            challenge.style.display = 'block';
        } else if (filter === 'completed' && status === 'completed') {
            challenge.style.display = 'block';
        } else if (filter === 'my-challenges') {
            // Show challenges created by user
            challenge.style.display = 'block';
        } else {
            challenge.style.display = 'none';
        }

        if (challenge.style.display === 'block') {
            challenge.style.animation = 'fadeIn 0.3s';
        }
    });
}

// Handle category change in create challenge modal (legacy - no longer used)
function handleCategoryChange() { }



// Handle challenge image upload
let challengeImageData = null;

function handleChallengeImage(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        event.target.value = '';
        return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        challengeImageData = e.target.result;

        // Show preview
        const preview = document.getElementById('challengeImagePreview');
        preview.innerHTML = `
            <div class="image-preview-item">
                <img src="${e.target.result}" alt="Challenge image">
                <button class="remove-image-btn" onclick="removeChallengeImage()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

// Remove challenge image
function removeChallengeImage() {
    challengeImageData = null;
    const input = document.getElementById('challengeImageUpload');
    if (input) input.value = '';
    const preview = document.getElementById('challengeImagePreview');
    if (preview) preview.innerHTML = '';
}
// Open create challenge modal
function openCreateChallengeModal() {
    if (!requireAuth('create a challenge')) return;
    const modal = document.getElementById('createChallengeModal');
    if (!modal) return;
    const step1 = document.getElementById('createChallengeStep1');
    const step2 = document.getElementById('createChallengeStep2');
    if (step1) step1.style.display = 'block';
    if (step2) step2.style.display = 'none';
    modal.style.display = 'flex';
    modal.style.alignItems = 'flex-start';
    modal.style.justifyContent = 'center';

    // Wire up live duration preview — runs once per modal open
    const numInput  = document.getElementById('challengeDuration');
    const unitInput = document.getElementById('challengeDurationUnit');
    function _updatePreview() {
        const n    = parseFloat(numInput?.value) || 0;
        const unit = unitInput?.value || 'days';
        const label = !n ? '—'
            : unit === 'minutes' ? (n === 1 ? '1 minute' : `${n} minutes`)
            : unit === 'hours'   ? (n === 1 ? '1 hour'   : `${n} hours`)
            : (n === 1 ? '1 day' : `${n} days`);
        // Update whichever preview element exists on the current page
        ['durationPreviewIndex', 'durationPreviewChallenges'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = label;
        });
    }
    numInput?.removeEventListener('input', _updatePreview);
    unitInput?.removeEventListener('change', _updatePreview);
    numInput?.addEventListener('input', _updatePreview);
    unitInput?.addEventListener('change', _updatePreview);
    _updatePreview();
}

// Select a category and move to step 2
function selectChallengeCategory(category) {
    document.getElementById('challengeCategory').value = category;

    // Hide all category-specific fields first
    document.getElementById('challengeImageGroup').style.display = 'none';
    document.getElementById('pollOptionsGroup').style.display = 'none';
    document.getElementById('debateSidesGroup').style.display = 'none';

    // Show relevant fields based on category
    if (category === 'qa') {
        document.getElementById('challengeImageGroup').style.display = 'block';
    } else if (category === 'polls') {
        document.getElementById('pollOptionsGroup').style.display = 'block';
    } else if (category === 'debates') {
        document.getElementById('debateSidesGroup').style.display = 'block';
    }

    // Transition to step 2
    document.getElementById('createChallengeStep1').style.display = 'none';
    document.getElementById('createChallengeStep2').style.display = 'block';
}

// Go back to category picker
function backToCategoryPicker() {
    document.getElementById('createChallengeStep2').style.display = 'none';
    document.getElementById('createChallengeStep1').style.display = 'block';
}

// Close create challenge modal
function closeCreateChallengeModal() {
    const modal = document.getElementById('createChallengeModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('socialChallengeForm')?.reset();
        // Reset category hidden field
        document.getElementById('challengeCategory').value = '';
        // Clear image state
        challengeImageData = null;
        const prev = document.getElementById('challengeImagePreview');
        if (prev) prev.innerHTML = '';
        document.getElementById('challengeImageGroup').style.display = 'none';
        document.getElementById('pollOptionsGroup').style.display = 'none';
        document.getElementById('debateSidesGroup').style.display = 'none';
    }
}

// Publish challenge — saves to backend DB, then instantly renders the new card
async function publishChallenge(event) {
    event.preventDefault();
    if (!requireAuth('create a challenge')) return;

    const title = document.getElementById('socialChallengeTitle').value.trim();
    const category = document.getElementById('challengeCategory').value;
    const durVal = document.getElementById('challengeDuration').value.trim();
    const durUnit = document.getElementById('challengeDurationUnit')?.value || 'days';
    const description = document.getElementById('socialChallengeDescription').value.trim();

    // Convert to fractional days for the backend; keep raw string for display
    let durationDays;
    let durationDisplay;
    const durNum = parseFloat(durVal) || 1;
    if (durUnit === 'minutes') {
        durationDays = durNum / (24 * 60);
        durationDisplay = `${durNum}m`;
    } else if (durUnit === 'hours') {
        durationDays = durNum / 24;
        durationDisplay = `${durNum}h`;
    } else {
        durationDays = durNum;
        durationDisplay = `${durNum}d`;
    }

    if (!title) { showNotification('Please enter a title.'); return; }

    const submitBtn = event.target.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'; }

    let endpoint, body;

    if (category === 'polls') {
        const options = [
            document.getElementById('pollOption1').value,
            document.getElementById('pollOption2').value,
            document.getElementById('pollOption3').value,
            document.getElementById('pollOption4').value,
        ].filter(o => o.trim());
        if (options.length < 2) {
            showNotification('Add at least 2 poll options.');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Challenge'; }
            return;
        }
        endpoint = `${API}/polls/create/`;
        body = { title, description, duration_days: durationDays, options };

    } else if (category === 'debates') {
        const side_a = document.getElementById('debateSideA').value.trim() || 'For';
        const side_b = document.getElementById('debateSideB').value.trim() || 'Against';
        endpoint = `${API}/debates/create/`;
        body = { title, description, side_a, side_b, duration_days: durationDays };

    } else if (category === 'qa') {
        endpoint = `${API}/qa/create/`;
        body = { title, description, duration_days: durationDays, image_url: challengeImageData || '' };
    }

    const { ok, data } = await apiPost(endpoint, body);

    if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-check"></i> Create Challenge'; }

    if (!ok) {
        showNotification(data.error || 'Failed to create challenge. Are you logged in?');
        return;
    }

    closeCreateChallengeModal();
    showNotification('Challenge created! 🏆');

    // Immediately inject the new card at the top of the grid
    _injectNewCard(category, data, title, description, durationDisplay, body);
}


/* ─── Inject a newly created card instantly at the top of the grid ─── */
function _injectNewCard(category, apiResponse, title, description, duration, body) {
    const grid = document.getElementById('challengesGrid');
    if (!grid) return;

    const id = apiResponse.id;
    const card = document.createElement('div');
    card.className = 'challenge-card';
    card.setAttribute('data-status', 'active');
    card.setAttribute('data-category', category);
    card.setAttribute('data-id', id);
    card.setAttribute('data-from-db', '1');
    card.style.animation = 'fadeIn 0.45s ease';

    if (category === 'debates') {
        card.innerHTML = buildDebateCard(
            id, title, description,
            body.side_a, body.side_b,
            duration, null
        );
        setTimeout(() => openDebateWS(id), 200);

    } else if (category === 'polls') {
        card.innerHTML = buildPollCard(id, title, description, body.options, duration);

    } else if (category === 'qa') {
        card.innerHTML = buildQACard(id, title, description, apiResponse.image_url || null, duration);
        setTimeout(() => openQAWS(id), 200);
    }

    // Prepend — newest challenge appears first
    grid.insertBefore(card, grid.firstChild);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    updateChallengeStats();
}

/* ── Card builders ── */

function buildDebateCard(id, title, description, sideA, sideB, duration, imgSrc) {
    const commentsA = '';
    const commentsB = '';

    return `
        <div class="debate-card-header">
            <span class="debate-type-label"><i class="fas fa-gavel"></i> Debate</span>
        </div>
        <p class="debate-card-title" style="padding:0 16px 10px;margin:0;">${title.toUpperCase()}</p>

        <div class="debate-arena">
            <!-- Team A side — red -->
            <div class="debate-team-pane debate-pane-a" id="debatePaneA_${id}">
                <div class="debate-pane-header pane-header-a">
                    <span class="debate-pane-team-label">Team A</span>
                    <span class="debate-pane-team-name">${sideA}</span>
                </div>
                <div class="debate-pane-feed" id="debateFeedA_${id}">
                    <div class="debate-feed-inner" id="debateFeedInnerA_${id}">
                        ${commentsA}
                    </div>
                </div>
            </div>
            <!-- Team B side — green -->
            <div class="debate-team-pane debate-pane-b" id="debatePaneB_${id}">
                <div class="debate-pane-header pane-header-b">
                    <span class="debate-pane-team-label">Team B</span>
                    <span class="debate-pane-team-name">${sideB}</span>
                </div>
                <div class="debate-pane-feed" id="debateFeedB_${id}">
                    <div class="debate-feed-inner" id="debateFeedInnerB_${id}">
                        ${commentsB}
                    </div>
                </div>
            </div>
        </div>

        <div class="debate-input-row">
            <input class="debate-text-input" placeholder="Share your take…" id="debateInput_${id}"
                onkeydown="if(event.key==='Enter') submitDebateComment('${id}')">
            <button class="debate-voice-btn" id="debateVoiceBtn_${id}" title="Voice note"
                onclick="toggleDebateVoice('${id}')">
                <i class="fas fa-microphone"></i>
            </button>
            <button class="debate-send-btn" onclick="submitDebateComment('${id}')">
                <i class="fas fa-paper-plane"></i>
            </button>
        </div>

        <div class="debate-teams">
            <div class="debate-team team-a">
                <span class="debate-team-label">Team A</span>
                <span class="debate-team-desc">${sideA}</span>
                <span class="debate-team-count" id="debateCountA_${id}"><i class="fas fa-user-friends"></i> 0 joined</span>
            </div>
            <div class="debate-team team-b">
                <span class="debate-team-label">Team B</span>
                <span class="debate-team-desc">${sideB}</span>
                <span class="debate-team-count" id="debateCountB_${id}"><i class="fas fa-user-friends"></i> 0 joined</span>
            </div>
        </div>

        <div class="debate-card-footer">
            <div style="display:flex;gap:8px;align-items:center;margin-left:auto;">
                <button class="share-challenge-btn" onclick="shareChallenge('${title.replace(/'/g, "\\'")}','${id}','debate')" title="Share">
                    <i class="fas fa-share-alt"></i>
                </button>
                <button class="xpoints-cost" onclick="joinDebate('${id}', event)">
                    <i class="fas fa-bolt"></i> Join
                </button>
            </div>
        </div>`;
}

/** Format a raw duration number smartly.
 *  ≤ 90  → "Xm" (minutes)
 *  ≤ 48h → "Xh" (hours, if duration_days was stored as fractional or 1-2)
 *  else  → "Xd" (days)
 *  The backend stores duration_days; values < 1 represent sub-day durations.
 *  We also accept a string like "30m" or "2h" passed directly.
 */
function _fmtDuration(val) {
    if (typeof val === 'string') {
        if (val.endsWith('m')) return val;
        if (val.endsWith('h')) return val;
        if (val.endsWith('d')) return val;
        val = parseFloat(val);
    }
    if (!val || isNaN(val)) return '—';
    if (val < 1 / 24) return `${Math.round(val * 24 * 60)}m`;  // sub-hour
    if (val < 1) return `${Math.round(val * 24)}h`;        // sub-day
    if (val === 1) return '1d';
    return `${val}d`;
}

function buildPollCard(id, title, description, options, duration) {
    const u = (() => { try { return JSON.parse(localStorage.getItem('pageUser') || '{}'); } catch { return {}; } })();
    const username = u.display_name || u.username || 'You';
    const avatarInner = (typeof avatarHTML === 'function')
        ? avatarHTML(u)
        : `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#6c63ff;color:#fff;font-weight:700;font-size:14px;">${username[0].toUpperCase()}</span>`;

    const optionsHTML = options.map((opt, i) => `
        <button class="poll-vote-btn" onclick="castPollVote('${id}', ${i}, this)">
            <div class="poll-vote-bar" style="width:0%"></div>
            <span class="poll-option-label">${opt}</span>
            <span class="poll-vote-pct" style="display:none">0%</span>
        </button>`).join('');

    return `
        <div class="poll-header-bar">
            <div class="poll-avatar">
                ${avatarInner}
            </div>
            <h3 class="poll-title">${title}</h3>
        </div>
        <div class="poll-options-list">${optionsHTML}</div>
        <div class="poll-card-footer">
            <div class="poll-meta">
                <span><i class="fas fa-users"></i> 0 votes</span>
            </div>
            <button class="share-challenge-btn" onclick="shareChallenge('${title.replace(/'/g, "\\'")}','${id}','poll')" title="Share">
                <i class="fas fa-share-alt"></i>
            </button>
        </div>`;
}

function buildQACard(id, title, description, imgSrc, duration) {
    const u = (() => { try { return JSON.parse(localStorage.getItem('pageUser') || '{}'); } catch { return {}; } })();
    const username = u.display_name || u.username || 'You';
    const avatarInner = (typeof avatarHTML === 'function')
        ? avatarHTML(u)
        : `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#6c63ff;color:#fff;font-weight:700;font-size:14px;">${username[0].toUpperCase()}</span>`;

    const imgSection = imgSrc ? `
        <div class="qa-img-preview-wrap" id="qaImgWrap_${id}">
            <button class="qa-img-toggle-btn" onclick="toggleQAImage('${id}')" aria-expanded="false"
                    aria-controls="qaImgPanel_${id}">
                <i class="fas fa-image"></i> View Image
            </button>
            <div class="qa-img-panel" id="qaImgPanel_${id}" style="display:none;">
                <img src="${imgSrc}" alt="Challenge image" class="qa-preview-img"
                    loading="lazy"
                    onerror="this.closest('.qa-img-panel').style.display='none'">
            </div>
        </div>` : '';

    const descSection = description ? `<p class="qa-description">${description}</p>` : '';

    return `
        <div class="qa-creator-avatar-wrap">
            <div class="qa-creator-avatar">${avatarInner}</div>
        </div>
        <p class="qa-question">${title}</p>
        ${descSection}
        ${imgSection}
        <div class="qa-live-pane" id="qaLive_${id}"></div>
        <div class="qa-input-row">
            <div class="qa-input-wrap">
                <input class="qa-type-input" placeholder="Type your answer…" id="qaInput_${id}"
                    maxlength="1000"
                    onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitQAAnswer('${id}');}"
                    oninput="document.getElementById('qaCounter_${id}').textContent=this.value.length+'/1000'">
                <span class="qa-char-counter" id="qaCounter_${id}">0/1000</span>
            </div>
            <button class="qa-send-btn" onclick="submitQAAnswer('${id}')">
                <i class="fas fa-paper-plane"></i>
            </button>
        </div>
        <div class="qa-card-footer">
            <div class="qa-meta"></div>
            <button class="share-challenge-btn" onclick="shareChallenge('${title.replace(/'/g, "\\'")}','${id}','Q&A')" title="Share">
                <i class="fas fa-share-alt"></i>
            </button>
        </div>`;
}

function toggleQAImage(id) {
    const panel = document.getElementById(`qaImgPanel_${id}`);
    const btn   = panel?.previousElementSibling;
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
}

/* ── Interaction handlers — all DB-backed ── */

async function joinDebate(challengeId, e) {
    if (!requireAuth('join a debate')) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const { ok, data } = await apiPost(`${API}/debates/${challengeId}/join/`, { side: 'a' });

    if (!ok) {
        showNotification(data.error || 'Could not join debate.');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-bolt"></i> 1.5 xP to Join';
        return;
    }

    btn.innerHTML = '<i class="fas fa-check"></i> Joined!';
    btn.style.background = '#1b7f3a';

    // Tag the card with the user's side so comments route correctly
    const card = btn.closest('.challenge-card');
    if (card) card.dataset.userSide = data.user_side || 'a';

    // Update participant counts on the card
    if (card && data.participants) {
        const aEl = card.querySelector(`#debateCountA_${challengeId}`);
        const bEl = card.querySelector(`#debateCountB_${challengeId}`);
        if (aEl) aEl.innerHTML = `<i class="fas fa-user-friends"></i> ${data.participants.a} joined`;
        if (bEl) bEl.innerHTML = `<i class="fas fa-user-friends"></i> ${data.participants.b} joined`;
    }

    renderXPointsBanner(data.balance);
    showNotification('+0.5 xP earned for joining! 🔥');
    const side = data.user_side || 'a';
    setTimeout(() => addLiveDebateComment(challengeId, 'You', 'Just joined the debate! 🔥', side), 300);
}

function addLiveDebateComment(challengeId, user, text, side) {
    side = side || 'b';
    const innerId = side === 'a' ? `debateFeedInnerA_${challengeId}` : `debateFeedInnerB_${challengeId}`;
    const inner = document.getElementById(innerId);
    if (!inner) return;

    const shade = side === 'a' ? 'hsl(0,60%,42%)' : 'hsl(140,50%,35%)';
    const el = document.createElement('div');
    el.className = 'debate-comment';
    el.innerHTML = `
        <div class="debate-comment-avatar" style="background:${shade};">${user[0].toUpperCase()}</div>
        <div class="debate-comment-body">
            <span class="comment-user">${user}</span>
            <span class="comment-text">${text}</span>
        </div>`;

    inner.appendChild(el);

    // Trim: fade out and remove oldest comment when too many are stacked
    const MAX_VISIBLE = 6;
    const comments = inner.querySelectorAll('.debate-comment');
    if (comments.length > MAX_VISIBLE) {
        const oldest = comments[0];
        oldest.classList.add('comment-exit');
        oldest.addEventListener('animationend', () => oldest.remove(), { once: true });
    }
}

async function submitDebateComment(challengeId) {
    const input = document.getElementById(`debateInput_${challengeId}`);
    const text = input?.value.trim();
    if (!text) return;
    if (!requireAuth('comment on a debate')) return;

    const username = localStorage.getItem('pageUser')
        ? (JSON.parse(localStorage.getItem('pageUser'))?.username || 'You')
        : 'You';

    // Determine which side the user is on (default 'b' until they join a team)
    const card = document.querySelector(`[data-id="${challengeId}"]`);
    const side = card?.dataset.userSide || 'b';

    addLiveDebateComment(challengeId, username, text, side);
    input.value = '';

    await apiPost(`${API}/debates/${challengeId}/comment/`, { text, side }).catch(() => { });
}

// Voice note recording for debates
const _debateVoiceState = {};

function toggleDebateVoice(challengeId) {
    if (!requireAuth('record a voice note')) return;

    const btn = document.getElementById(`debateVoiceBtn_${challengeId}`);
    const state = _debateVoiceState[challengeId];

    if (state?.recording) {
        // Stop recording
        state.recorder?.stop();
        state.stream?.getTracks().forEach(t => t.stop());
        btn?.classList.remove('recording');
        btn.innerHTML = '<i class="fas fa-microphone"></i>';
        _debateVoiceState[challengeId] = null;
        showNotification('Voice note sent! 🎤');
        return;
    }

    // Start recording
    if (!navigator.mediaDevices?.getUserMedia) {
        showNotification('Voice notes not supported on this browser.');
        return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const username = localStorage.getItem('pageUser')
                ? (JSON.parse(localStorage.getItem('pageUser'))?.username || 'You')
                : 'You';
            addLiveDebateComment(challengeId, username, '🎤 Sent a voice note');

            // Upload to backend (best-effort)
            const fd = new FormData();
            fd.append('audio', blob, 'voice.webm');
            const token = getAuthToken();
            fetch(`${API}/debates/${challengeId}/voice/`, {
                method: 'POST',
                headers: token ? { 'Authorization': `Token ${token}` } : {},
                body: fd,
            }).catch(() => { });
        };
        recorder.start();
        _debateVoiceState[challengeId] = { recorder, stream, recording: true };
        btn?.classList.add('recording');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        showNotification('Recording… tap again to send 🎤');

        // Auto-stop after 60s
        setTimeout(() => {
            if (_debateVoiceState[challengeId]?.recording) toggleDebateVoice(challengeId);
        }, 60000);
    }).catch(() => {
        showNotification('Microphone permission denied.');
    });
}

async function castPollVote(challengeId, optionIndex, btn) {
    if (!requireAuth('vote on a poll')) return;
    const list = btn.closest('.poll-options-list');
    const allBtns = list.querySelectorAll('.poll-vote-btn');
    allBtns.forEach(b => b.disabled = true);

    const { ok, data } = await apiPost(`${API}/polls/${challengeId}/vote/`, { option_index: optionIndex });

    if (!ok) {
        showNotification(data.error || 'Could not cast vote.');
        allBtns.forEach(b => b.disabled = false);
        return;
    }

    // Apply fresh counts from server and mark chosen option
    _applyPollUpdate(challengeId, data.vote_counts, data.total_votes);
    allBtns.forEach((b, i) => {
        if (i === optionIndex) b.classList.add('voted');
        b.disabled = true;
    });

    const card = btn.closest('.challenge-card');
    _updatePollFooterCount(card, data.total_votes, true);

    renderXPointsBanner(data.balance);
    showNotification('+0.5 xP earned for voting! 📊');
}

async function submitQAAnswer(challengeId) {
    if (!requireAuth('answer a question')) return;
    const input = document.getElementById(`qaInput_${challengeId}`);
    const text = input?.value.trim();
    if (!text) return;

    const { ok, data } = await apiPost(`${API}/qa/${challengeId}/answer/`, { text });

    if (!ok) {
        showNotification(data.error || 'Could not submit answer.');
        return;
    }

    // Add own bubble immediately
    const pane = document.getElementById(`qaLive_${challengeId}`);
    if (pane) {
        const username = data.user || 'You';
        const el = document.createElement('div');
        el.className = 'qa-live-msg own';
        el.innerHTML = `
            <div class="qa-live-avatar">${username[0].toUpperCase()}</div>
            <div class="qa-live-bubble">
                <span class="qa-live-user">${username}</span>
                <span class="qa-live-text">${text}</span>
            </div>`;
        pane.appendChild(el);
        pane.scrollTop = pane.scrollHeight;
        const msgs = pane.querySelectorAll('.qa-live-msg');
        if (msgs.length > 12) msgs[0].remove();
    }

    input.value = '';
    renderXPointsBanner(data.balance);
    showNotification('+0.5 xP earned for answering! 💬');
}



// Attempt challenge
function attemptChallenge(challengeId) {
    currentChallengeId = challengeId;

    // Get challenge details
    const challengeCard = document.querySelector(`[data-id="${challengeId}"]`);
    if (!challengeCard) return;

    const title = challengeCard.querySelector('.challenge-title').textContent;
    const description = challengeCard.querySelector('.challenge-description').textContent;
    const prizeText = challengeCard.querySelector('.challenge-badge').textContent;
    const category = challengeCard.getAttribute('data-category') || 'general';
    const challengeImage = challengeCard.getAttribute('data-image');

    // Populate modal
    document.getElementById('attemptChallengeTitle').textContent = title;
    document.getElementById('attemptChallengeDescription').textContent = description;
    document.getElementById('attemptChallengePrize').textContent = prizeText.replace('Prize', '').trim();

    // Show challenge image if it's an image interpretation challenge
    const modalBody = document.querySelector('#attemptChallengeModal .modal-body');
    const existingImage = modalBody.querySelector('.challenge-image-display');
    if (existingImage) {
        existingImage.remove();
    }

    if (category === 'image-interpretation' && challengeImage) {
        const imageDisplay = document.createElement('div');
        imageDisplay.className = 'challenge-image-display';
        imageDisplay.style.cssText = 'margin: 20px 0; text-align: center;';
        imageDisplay.innerHTML = `
            <h4 style="margin-bottom: 12px; color: #556b2f;">
                <i class="fas fa-image"></i> Image to Interpret:
            </h4>
            <img src="${challengeImage}" alt="Challenge image" style="max-width: 100%; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="margin-top: 12px; color: #65676b; font-size: 14px;">
                <i class="fas fa-info-circle"></i> Provide a detailed interpretation (minimum 100 words)
            </p>
        `;

        const form = modalBody.querySelector('form');
        form.insertBefore(imageDisplay, form.firstChild);

        // Update submission placeholder for image interpretation
        const submissionText = document.getElementById('submissionText');
        submissionText.placeholder = 'Write your detailed interpretation of the image (minimum 100 words)...';
        submissionText.rows = 8;
    } else {
        // Reset placeholder for other challenge types
        const submissionText = document.getElementById('submissionText');
        submissionText.placeholder = 'Describe your solution or provide links...';
        submissionText.rows = 4;
    }

    // Open modal
    const modal = document.getElementById('attemptChallengeModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Close attempt challenge modal
function closeAttemptChallengeModal() {
    const modal = document.getElementById('attemptChallengeModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('attemptChallengeForm').reset();
        submissionFiles = [];
        document.getElementById('submissionFilesPreview').innerHTML = '';
    }
}

// Handle submission files
function handleSubmissionFiles(event) {
    const files = Array.from(event.target.files);
    const preview = document.getElementById('submissionFilesPreview');

    files.forEach(file => {
        submissionFiles.push(file);

        const fileItem = document.createElement('div');
        fileItem.className = 'file-preview-item';

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function (e) {
                fileItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            const reader = new FileReader();
            reader.onload = function (e) {
                fileItem.innerHTML = `
                    <video src="${e.target.result}"></video>
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            fileItem.innerHTML = `
                <i class="fas fa-file"></i>
                <button class="remove-file-btn" onclick="removeSubmissionFile(${submissionFiles.length - 1})">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }

        preview.appendChild(fileItem);
    });
}

// Remove submission file
function removeSubmissionFile(index) {
    submissionFiles.splice(index, 1);

    // Rebuild preview
    const preview = document.getElementById('submissionFilesPreview');
    preview.innerHTML = '';

    submissionFiles.forEach((file, idx) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-preview-item';

        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function (e) {
                fileItem.innerHTML = `
                    <img src="${e.target.result}" alt="Preview">
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            const reader = new FileReader();
            reader.onload = function (e) {
                fileItem.innerHTML = `
                    <video src="${e.target.result}"></video>
                    <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
            };
            reader.readAsDataURL(file);
        } else {
            fileItem.innerHTML = `
                <i class="fas fa-file"></i>
                <button class="remove-file-btn" onclick="removeSubmissionFile(${idx})">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }

        preview.appendChild(fileItem);
    });
}

// Submit challenge attempt
async function submitChallengeAttempt(event) {
    event.preventDefault();

    const submissionText = document.getElementById('submissionText').value;
    const submissionLink = document.getElementById('submissionLink').value;

    // Get challenge details
    const challengeCard = document.querySelector(`[data-id="${currentChallengeId}"]`);
    if (!challengeCard) return;

    const challengeTitle = challengeCard.querySelector('.challenge-title').textContent;
    const prizeText = document.getElementById('attemptChallengePrize').textContent;
    const prizeAmount = parseFloat(prizeText.replace('K', '').replace('Prize', '').trim());

    // Show loading
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
    submitBtn.disabled = true;

    try {
        // Verify challenge submission with backend
        const isVerified = await verifyChallengeSubmission({
            challengeId: currentChallengeId,
            challengeTitle: challengeTitle,
            submissionText: submissionText,
            submissionLink: submissionLink,
            files: submissionFiles
        });

        if (isVerified) {
            // Mark as completed
            challengeCard.setAttribute('data-status', 'completed');
            challengeCard.classList.add('challenge-success');

            // Add money to wallet via backend
            await addMoneyToWalletBackend(prizeAmount, currentChallengeId);

            // Update stats
            updateChallengeStats();

            // Close modal
            closeAttemptChallengeModal();

            // Show success with money earned
            showSuccessModal(prizeAmount);
        } else {
            // Verification failed
            alert('❌ Challenge verification failed. Please check your submission and try again.');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }

    } catch (error) {
        console.error('Challenge submission error:', error);
        alert(`❌ Submission failed: ${error.message}`);
        submitBtn.innerHTML = originalBtnText;
        submitBtn.disabled = false;
    }
}

// Verify challenge submission
async function verifyChallengeSubmission(submission) {
    // Get challenge card to determine type
    const challengeCard = document.querySelector(`[data-id="${submission.challengeId}"]`);
    if (!challengeCard) return false;

    // Get challenge category from card
    const categoryIcon = challengeCard.querySelector('.challenge-icon i');
    let challengeType = 'general';

    if (categoryIcon) {
        if (categoryIcon.classList.contains('fa-code')) challengeType = 'coding';
        else if (categoryIcon.classList.contains('fa-brain')) challengeType = 'trivia';
        else if (categoryIcon.classList.contains('fa-gamepad')) challengeType = 'gaming';
        else if (categoryIcon.classList.contains('fa-palette')) challengeType = 'creative';
    }

    // Validate submission has content
    if (!submission.submissionText && !submission.submissionLink && submission.files.length === 0) {
        throw new Error('Please provide a submission (text, link, or files)');
    }

    // For now, use client-side verification
    // In production, this should call Django backend API
    const token = localStorage.getItem('djangoAuthToken');

    if (token) {
        // Try to verify with backend
        try {
            const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
            const response = await fetch(`${API_BASE_URL}/challenges/verify/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    challenge_id: submission.challengeId,
                    challenge_type: challengeType,
                    submission_text: submission.submissionText,
                    submission_link: submission.submissionLink,
                    has_files: submission.files.length > 0
                })
            });

            if (response.ok) {
                const data = await response.json();
                return data.verified === true;
            }
        } catch (error) {
            console.warn('Backend verification unavailable, using client-side validation:', error);
        }
    }

    // Fallback: Client-side verification rules
    switch (challengeType) {
        case 'trivia':
            // For trivia, require text answer
            return submission.submissionText && submission.submissionText.length >= 3;

        case 'coding':
            // For coding, require link or files
            return submission.submissionLink || submission.files.length > 0;

        case 'creative':
            // For creative, require files (images/videos)
            return submission.files.length > 0;

        case 'gaming':
            // For gaming, require proof (screenshot/video)
            return submission.files.length > 0 || submission.submissionLink;

        case 'image-interpretation':
            // For image interpretation, require text (min 100 words)
            if (!submission.submissionText) return false;
            const wordCount = submission.submissionText.trim().split(/\s+/).length;
            if (wordCount < 100) {
                throw new Error('Image interpretation must be at least 100 words');
            }
            return true;

        default:
            // General challenges require any submission
            return submission.submissionText || submission.submissionLink || submission.files.length > 0;
    }
}

// Add money to wallet via backend
async function addMoneyToWalletBackend(amount, challengeId) {
    const token = localStorage.getItem('djangoAuthToken');

    if (token) {
        // Add earnings via Django backend
        try {
            const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
            const response = await fetch(`${API_BASE_URL}/payments/wallet/add-earnings/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    amount: amount,
                    game_type: 'challenge',
                    game_id: challengeId
                })
            });

            if (response.ok) {
                const data = await response.json();

                // Update UI with backend wallet data
                if (data.wallet) {
                    updateWalletUI(data.wallet.available_balance);
                }

                return true;
            } else {
                console.warn('Backend wallet update failed, using localStorage fallback');
            }
        } catch (error) {
            console.warn('Backend unavailable, using localStorage fallback:', error);
        }
    }

    // Fallback: Update localStorage
    addMoneyToWalletLocal(amount, challengeId);
    return true;
}

// Add money to wallet (localStorage fallback)
function addMoneyToWalletLocal(amount, challengeId) {
    // Get current balance
    const balanceElement = document.getElementById('walletBalance');
    const currentBalance = parseFloat(balanceElement?.textContent.replace('K', '') || '0');

    // Add prize money
    const newBalance = currentBalance + amount;

    // Update UI
    updateWalletUI(newBalance);

    // Store in localStorage
    localStorage.setItem('walletBalance', newBalance.toFixed(2));

    // Create transaction record
    const transaction = {
        type: 'challenge_reward',
        amount: amount,
        date: new Date().toISOString(),
        description: 'Challenge completion reward',
        challenge_id: challengeId
    };

    // Store transaction
    const transactions = JSON.parse(localStorage.getItem('transactions') || '[]');
    transactions.unshift(transaction);
    localStorage.setItem('transactions', JSON.stringify(transactions));
}

// Update wallet UI
function updateWalletUI(balance) {
    const balanceElement = document.getElementById('walletBalance');
    if (balanceElement) {
        balanceElement.textContent = `K${parseFloat(balance).toFixed(2)}`;
    }

    // Update wallet badge
    const walletBadge = document.getElementById('walletBalanceBadge');
    if (walletBadge) {
        walletBadge.style.display = 'flex';
    }

    // Update user menu balance
    const userMenuBalance = document.getElementById('userMenuBalance');
    if (userMenuBalance) {
        userMenuBalance.textContent = `K${parseFloat(balance).toFixed(2)}`;
    }
}

// Show success modal
function showSuccessModal(amount) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px; text-align: center;">
            <div style="font-size: 64px; color: #4caf50; margin-bottom: 20px;">
                <i class="fas fa-check-circle"></i>
            </div>
            <h2 style="color: #333; margin-bottom: 16px;">Challenge Completed! 🎉</h2>
            <p style="color: #65676b; margin-bottom: 24px;">Congratulations! You've successfully completed the challenge.</p>
            <div style="background: linear-gradient(to right, #ffd700, #ffed4e); padding: 20px; border-radius: 12px; margin-bottom: 24px;">
                <div style="font-size: 14px; color: #000; margin-bottom: 8px;">You earned</div>
                <div style="font-size: 36px; font-weight: bold; color: #000;">K${amount.toFixed(2)}</div>
            </div>
            <button class="btn-primary" onclick="this.closest('.modal').remove()" style="width: 100%;">
                <i class="fas fa-wallet"></i> View Wallet
            </button>
        </div>
    `;

    document.body.appendChild(modal);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        modal.style.animation = 'fadeOut 0.3s';
        setTimeout(() => modal.remove(), 300);
    }, 5000);
}

// Update challenge stats
function updateChallengeStats() {
    const completedChallenges = document.querySelectorAll('[data-status="completed"]').length;
    const activeChallenges = document.querySelectorAll('[data-status="active"]').length;

    // Get total earned from localStorage
    const balance = parseFloat(localStorage.getItem('walletBalance') || '0');

    // Calculate success rate
    const totalAttempts = completedChallenges + 5; // Assuming some failed attempts
    const successRate = totalAttempts > 0 ? Math.round((completedChallenges / totalAttempts) * 100) : 0;

    // Update displays
    document.getElementById('completedChallenges').textContent = completedChallenges;
    document.getElementById('activeChallenges').textContent = activeChallenges;
    document.getElementById('totalEarned').textContent = `K${balance.toFixed(2)}`;
    document.getElementById('successRate').textContent = `${successRate}%`;
}

// View challenge details
function viewChallengeDetails(challengeId) {
    alert('Challenge details view coming soon!');
}

// Initialize
document.addEventListener('DOMContentLoaded', async function () {
    // Load wallet balance from localStorage
    const savedBalance = localStorage.getItem('walletBalance');
    if (savedBalance) {
        const balanceElement = document.getElementById('walletBalance');
        if (balanceElement) balanceElement.textContent = `K${parseFloat(savedBalance).toFixed(2)}`;
        const walletBadge = document.getElementById('walletBalanceBadge');
        if (walletBadge) walletBadge.style.display = 'flex';
    }

    // Load real xPoints from DB
    await refreshXPoints();

    // Load DB challenges immediately (challenges section is visible by default on some views)
    await loadAndRenderChallenges();

    // Hook into switchView so challenges reload fresh whenever the tab is opened
    const _originalSwitchView = window.switchView;
    window.switchView = function (viewName) {
        if (_originalSwitchView) _originalSwitchView(viewName);
        if (viewName === 'challenges') {
            loadAndRenderChallenges();
        }
    };

    updateChallengeStats();
});

/* ── Load challenges from DB and render cards ── */
async function loadAndRenderChallenges() {
    const grid = document.getElementById('challengesGrid');
    if (!grid) return;

    // Show a loading indicator while fetching — only if there are no DB cards yet
    const hasExisting = grid.querySelector('[data-from-db="1"]');
    if (!hasExisting) {
        const spinner = document.createElement('div');
        spinner.id = 'challengesLoadingSpinner';
        spinner.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:#aaa;font-size:14px;';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:24px;margin-bottom:10px;display:block;"></i>Loading challenges…';
        grid.insertBefore(spinner, grid.firstChild);
    }

    // Fetch all three types in parallel
    const [debates, polls, qas] = await Promise.all([
        apiGet(`${API}/debates/`),
        apiGet(`${API}/polls/`),
        apiGet(`${API}/qa/`),
    ]);

    // Remove spinner and previously injected DB cards (keep the static samples)
    document.getElementById('challengesLoadingSpinner')?.remove();
    grid.querySelectorAll('.challenge-card[data-from-db="1"]').forEach(c => c.remove());

    // Nothing from DB yet — nothing extra to render
    if (!debates?.length && !polls?.length && !qas?.length) {
        updateChallengeStats();
        return;
    }

    const fragment = document.createDocumentFragment();

    // Render debates
    (debates || []).forEach(d => {
        const card = document.createElement('div');
        card.className = 'challenge-card';
        card.setAttribute('data-status', 'active');
        card.setAttribute('data-category', 'debates');
        card.setAttribute('data-id', d.id);
        card.setAttribute('data-from-db', '1');
        card.innerHTML = buildDebateCard(d.id, d.title, d.description, d.side_a, d.side_b,
            d.duration_days, d.image_url || null);
        setTimeout(() => {
            (d.comments || []).slice(-5).forEach(c => addLiveDebateComment(d.id, c.user, c.text, c.side || 'b'));
            openDebateWS(d.id);
        }, 100);
        fragment.appendChild(card);
    });

    // Render polls
    (polls || []).forEach(p => {
        const card = document.createElement('div');
        card.className = 'challenge-card';
        card.setAttribute('data-status', 'active');
        card.setAttribute('data-category', 'polls');
        card.setAttribute('data-id', p.id);
        card.setAttribute('data-from-db', '1');
        card.innerHTML = buildPollCard(p.id, p.title, p.description, p.options,
            p.duration_days);
        // Always restore current vote counts — whether the user voted or not
        setTimeout(() => restorePollState(card, p), 100);
        // Start polling for live vote updates from other users
        setTimeout(() => {
            _startPollVoteSync(p.id);
            openPollWS(p.id);
        }, 200);
        fragment.appendChild(card);
    });

    // Render Q&As
    (qas || []).forEach(q => {
        const card = document.createElement('div');
        card.className = 'challenge-card';
        card.setAttribute('data-status', 'active');
        card.setAttribute('data-category', 'qa');
        card.setAttribute('data-id', q.id);
        card.setAttribute('data-from-db', '1');
        card.innerHTML = buildQACard(q.id, q.title, q.description, q.image_url || null,
            q.duration_days);
        setTimeout(() => {
            const pane = document.getElementById(`qaLive_${q.id}`);
            if (pane) {
                pane.innerHTML = '';
                (q.answers || []).slice(-8).forEach(a => {
                    const el = document.createElement('div');
                    el.className = 'qa-live-msg';
                    el.innerHTML = `
                        <div class="qa-live-avatar">${a.user[0].toUpperCase()}</div>
                        <div class="qa-live-bubble">
                            <span class="qa-live-user">${a.user}</span>
                            <span class="qa-live-text">${a.text}</span>
                        </div>`;
                    pane.appendChild(el);
                });
                pane.scrollTop = pane.scrollHeight;
            }
            openQAWS(q.id);
        }, 100);
        fragment.appendChild(card);
    });

    // Prepend DB cards — newest at the top, static samples stay below
    grid.insertBefore(fragment, grid.firstChild);
    updateChallengeStats();
}

function restorePollState(card, pollData) {
    const allBtns = card.querySelectorAll('.poll-vote-btn');
    const total = pollData.total_votes || 0;

    allBtns.forEach((b, i) => {
        const count = pollData.vote_counts?.[i] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const bar = b.querySelector('.poll-vote-bar');
        const pctEl = b.querySelector('.poll-vote-pct');

        if (pctEl) { pctEl.style.display = 'inline'; pctEl.textContent = `${pct}%`; }
        setTimeout(() => { if (bar) bar.style.width = `${pct}%`; }, 60);

        if (pollData.user_voted) b.disabled = true;
    });

    // Update the vote count in the footer
    _updatePollFooterCount(card, total, pollData.user_voted);
}

/** Apply fresh vote data to a poll card already in the DOM. */
function _applyPollUpdate(pollId, voteCounts, totalVotes) {
    const card = document.querySelector(`.challenge-card[data-id="${pollId}"]`);
    if (!card) return;

    const allBtns = card.querySelectorAll('.poll-vote-btn');
    allBtns.forEach((b, i) => {
        const count = voteCounts?.[i] || 0;
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const bar = b.querySelector('.poll-vote-bar');
        const pctEl = b.querySelector('.poll-vote-pct');

        if (pctEl) { pctEl.style.display = 'inline'; pctEl.textContent = `${pct}%`; }
        if (bar) {
            bar.style.transition = 'width 0.5s ease';
            bar.style.width = `${pct}%`;
        }
    });

    _updatePollFooterCount(card, totalVotes, false);
}

function _updatePollFooterCount(card, total, userVoted) {
    const meta = card.querySelector('.poll-card-footer .poll-meta');
    if (!meta) return;
    const votesEl = meta.querySelector('span:first-child');
    if (!votesEl) return;

    if (userVoted) {
        votesEl.innerHTML = '<i class="fas fa-check-circle" style="color:#1b7f3a"></i> Voted!';
    } else {
        votesEl.innerHTML = `<i class="fas fa-users"></i> ${total} vote${total !== 1 ? 's' : ''}`;
    }
}

/* ── Poll vote sync — polls every 10s for live vote counts from other users ── */
const _pollSyncIntervals = {};

function _startPollVoteSync(pollId) {
    if (!pollId || pollId.length < 10) return;
    if (_pollSyncIntervals[pollId]) return;   // already running

    _pollSyncIntervals[pollId] = setInterval(async () => {
        // Stop syncing if the card has been removed from the DOM
        const card = document.querySelector(`.challenge-card[data-id="${pollId}"]`);
        if (!card) {
            clearInterval(_pollSyncIntervals[pollId]);
            delete _pollSyncIntervals[pollId];
            return;
        }
        // Don't fetch if the tab is hidden
        if (document.hidden) return;

        try {
            const polls = await apiGet(`${API}/polls/`);
            const fresh = (polls || []).find(p => String(p.id) === String(pollId));
            if (!fresh) return;
            _applyPollUpdate(pollId, fresh.vote_counts, fresh.total_votes);
        } catch (_) { /* silent — network hiccup */ }
    }, 10_000);   // every 10 seconds
}

/* ── WebSocket connections for live comments ── */
const _wsSockets = {};
let _wsSupported = null;   // null = unknown, true/false after first probe

async function _checkWsSupport() {
    if (_wsSupported !== null) return _wsSupported;

    // Check sessionStorage cache first (avoids repeated network calls)
    const cached = sessionStorage.getItem('ws_supported');
    if (cached !== null) {
        _wsSupported = cached === 'true';
        return _wsSupported;
    }

    try {
        const r = await fetch('/api/ws-status/');
        const d = await r.json();
        _wsSupported = !!d.ws_supported;
    } catch (_) {
        _wsSupported = false;
    }

    sessionStorage.setItem('ws_supported', String(_wsSupported));
    console.info(`[PAGE] WebSocket mode: ${_wsSupported ? 'Real-time (Redis)' : 'Polling fallback'}`);
    return _wsSupported;
}

function openPollWS(pollId) {
    if (!pollId || pollId.length < 10) return;
    if (_wsSockets[`poll_${pollId}`]) return;

    _checkWsSupport().then(supported => {
        if (!supported) {
            // Already covered by _startPollVoteSync interval
            return;
        }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const _wsToken = localStorage.getItem('djangoAuthToken') || '';
        const ws = new WebSocket(`${proto}://${location.host}/ws/poll/${pollId}/?token=${encodeURIComponent(_wsToken)}`);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'poll_vote' && msg.payload) {
                    const { poll_id, vote_counts, total_votes } = msg.payload;
                    // Only apply if the user on this device hasn't voted yet
                    // (if they voted, the buttons are already disabled with correct counts)
                    const card = document.querySelector(`.challenge-card[data-id="${poll_id}"]`);
                    const hasVoted = card?.querySelector('.poll-vote-btn.voted');
                    if (!hasVoted) {
                        _applyPollUpdate(poll_id, vote_counts, total_votes);
                        _updatePollFooterCount(card, total_votes, false);
                    }
                }
            } catch (_) { }
        };

        ws.onerror = () => {
            _wsSupported = false;
            delete _wsSockets[`poll_${pollId}`];
            // Polling sync already running as fallback
        };

        ws.onclose = () => {
            delete _wsSockets[`poll_${pollId}`];
            if (_wsSupported) setTimeout(() => openPollWS(pollId), 5000);
        };

        _wsSockets[`poll_${pollId}`] = ws;
    });
}

function openDebateWS(debateId) {    // Don't open WS for static sample IDs (non-UUID single chars)
    if (!debateId || debateId.length < 10) return;
    if (_wsSockets[`debate_${debateId}`]) return;

    _checkWsSupport().then(supported => {
        if (!supported) {
            // Render free tier — poll for new comments every 8s instead
            _pollDebateComments(debateId);
            return;
        }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const _wsToken = localStorage.getItem('djangoAuthToken') || '';
        const ws = new WebSocket(`${proto}://${location.host}/ws/debate/${debateId}/?token=${encodeURIComponent(_wsToken)}`);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'debate_comment' && msg.payload) {
                    const { user, text, side } = msg.payload;
                    const resolvedSide = side || 'b';

                    // Update the card's inline feed
                    addLiveDebateComment(debateId, user, text, resolvedSide);

                    // Mirror into the live modal if it's open for this debate
                    if (typeof _chAddDebateComment === 'function') {
                        _chAddDebateComment(debateId, user, text, resolvedSide);
                    }
                }
            } catch (_) { }
        };

        ws.onerror = () => {
            // WS failed — fall back to polling silently
            _wsSupported = false;
            delete _wsSockets[`debate_${debateId}`];
            _pollDebateComments(debateId);
        };

        ws.onclose = () => {
            delete _wsSockets[`debate_${debateId}`];
            // Only reconnect if WS is still supported
            if (_wsSupported) {
                setTimeout(() => openDebateWS(debateId), 5000);
            }
        };

        _wsSockets[`debate_${debateId}`] = ws;
    });
}

function openQAWS(qaId) {
    if (!qaId || qaId.length < 10) return;
    if (_wsSockets[`qa_${qaId}`]) return;

    _checkWsSupport().then(supported => {
        if (!supported) {
            _pollQAAnswers(qaId);
            return;
        }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const _wsToken = localStorage.getItem('djangoAuthToken') || '';
        const ws = new WebSocket(`${proto}://${location.host}/ws/qa/${qaId}/?token=${encodeURIComponent(_wsToken)}`);

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'qa_answer' && msg.payload) {
                    const pane = document.getElementById(`qaLive_${qaId}`);
                    if (!pane) return;
                    const el = document.createElement('div');
                    el.className = 'qa-live-msg';
                    el.innerHTML = `
                        <div class="qa-live-avatar">${msg.payload.user[0].toUpperCase()}</div>
                        <div class="qa-live-bubble">
                            <span class="qa-live-user">${msg.payload.user}</span>
                            <span class="qa-live-text">${msg.payload.text}</span>
                        </div>`;
                    pane.appendChild(el);
                    pane.scrollTop = pane.scrollHeight;
                    const msgs = pane.querySelectorAll('.qa-live-msg');
                    if (msgs.length > 12) msgs[0].remove();
                }
            } catch (_) { }
        };

        ws.onerror = () => {
            _wsSupported = false;
            delete _wsSockets[`qa_${qaId}`];
            _pollQAAnswers(qaId);
        };

        ws.onclose = () => {
            delete _wsSockets[`qa_${qaId}`];
            if (_wsSupported) setTimeout(() => openQAWS(qaId), 5000);
        };

        _wsSockets[`qa_${qaId}`] = ws;
    });
}

/* ── HTTP polling fallback (used when WebSockets aren't available) ── */
const _pollIntervals = {};

function _pollDebateComments(debateId) {
    if (_pollIntervals[`debate_${debateId}`]) return;
    let lastCount = 0;

    _pollIntervals[`debate_${debateId}`] = setInterval(async () => {
        // Stop if the card is gone from the DOM
        const card = document.querySelector(`.challenge-card[data-id="${debateId}"]`);
        if (!card) {
            clearInterval(_pollIntervals[`debate_${debateId}`]);
            delete _pollIntervals[`debate_${debateId}`];
            return;
        }
        if (document.hidden) return;

        const data = await apiGet(`${API}/debates/`);
        const debate = (data || []).find(d => String(d.id) === String(debateId));
        if (!debate) return;
        const comments = debate.comments || [];
        if (comments.length > lastCount) {
            comments.slice(lastCount).forEach(c => {
                const side = c.side || 'b';
                addLiveDebateComment(debateId, c.user, c.text, side);
                if (typeof _chAddDebateComment === 'function') {
                    _chAddDebateComment(debateId, c.user, c.text, side);
                }
            });
            lastCount = comments.length;
        }
    }, 8000);
}

function _pollQAAnswers(qaId) {
    if (_pollIntervals[`qa_${qaId}`]) return;
    let lastCount = 0;

    _pollIntervals[`qa_${qaId}`] = setInterval(async () => {
        const pane = document.getElementById(`qaLive_${qaId}`);
        if (!pane) {
            clearInterval(_pollIntervals[`qa_${qaId}`]);
            delete _pollIntervals[`qa_${qaId}`];
            return;
        }
        const data = await apiGet(`${API}/qa/`);
        const qa = (data || []).find(q => q.id === qaId);
        if (!qa) return;
        const answers = qa.answers || [];
        if (answers.length > lastCount) {
            answers.slice(lastCount).forEach(a => {
                const el = document.createElement('div');
                el.className = 'qa-live-msg';
                el.innerHTML = `
                    <div class="qa-live-avatar">${a.user[0].toUpperCase()}</div>
                    <div class="qa-live-bubble">
                        <span class="qa-live-user">${a.user}</span>
                        <span class="qa-live-text">${a.text}</span>
                    </div>`;
                pane.appendChild(el);
                pane.scrollTop = pane.scrollHeight;
                const msgs = pane.querySelectorAll('.qa-live-msg');
                if (msgs.length > 12) msgs[0].remove();
            });
            lastCount = answers.length;
        }
    }, 8000);
}

/* ── Share Challenge ── */
function shareChallenge(title, id, category) {
    const url = `${location.origin}${location.pathname}#challenge-${id}`;
    const text = `Check out this ${category} challenge on PAGE: "${title}"`;

    if (navigator.share) {
        navigator.share({ title: `PAGE — ${title}`, text, url }).catch(() => { });
        return;
    }

    // Fallback: show mini share menu
    const existing = document.getElementById('shareMenu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'shareMenu';
    menu.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e4e6ea;border-radius:16px;padding:16px 20px;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.15);min-width:260px;';
    menu.innerHTML = `
        <p style="margin:0 0 12px;font-weight:700;font-size:14px;color:#1c1e21;">Share Challenge</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">
            <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}" target="_blank" class="share-btn" style="background:#1DA1F2;">
                <i class="fab fa-twitter"></i> Twitter
            </a>
            <a href="https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}" target="_blank" class="share-btn" style="background:#25D366;">
                <i class="fab fa-whatsapp"></i> WhatsApp
            </a>
            <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" class="share-btn" style="background:#1877F2;">
                <i class="fab fa-facebook"></i> Facebook
            </a>
            <button onclick="navigator.clipboard.writeText('${url}').then(()=>showNotification('Link copied! 📋')); document.getElementById('shareMenu').remove();" class="share-btn" style="background:#555;border:none;cursor:pointer;">
                <i class="fas fa-link"></i> Copy Link
            </button>
        </div>
        <button onclick="document.getElementById('shareMenu').remove()" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:18px;cursor:pointer;color:#888;">×</button>`;
    document.body.appendChild(menu);
    setTimeout(() => { if (document.getElementById('shareMenu')) document.getElementById('shareMenu').remove(); }, 6000);
}


/* Simulate live comments flowing in on a debate card */
const DEMO_COMMENTS = [
    { user: 'Bright', text: 'Team A is dominating right now 🏆' },
    { user: 'Chileshe', text: 'Nah Team B has the better argument 🤔' },
    { user: 'Mumba', text: 'This is heating up 🔥' },
    { user: 'Zed', text: 'I voted Team A, let\'s go!' },
    { user: 'Ludo', text: 'Team B making valid points tbh' },
    { user: 'Grace', text: 'Both sides are strong wow' },
    { user: 'Neo', text: 'Already earned my 0.5 xP 💪' },
];
let _commentIdx = 0;

function startDebateLiveComments(cardId) {
    setInterval(() => {
        const c = DEMO_COMMENTS[_commentIdx % DEMO_COMMENTS.length];
        addLiveDebateComment(cardId, c.user, c.text);
        _commentIdx++;
    }, 4000);
}

const QA_DEMO_RESPONSES = [
    { user: 'Mumba', text: 'Gunna dropped too many hits to ignore 🎶' },
    { user: 'Ludo', text: 'Dave spits facts every verse, no cap 🧠' },
    { user: 'Grace', text: 'Both legends but Gunna in a different lane' },
    { user: 'Neo', text: 'Dave is poetry, Gunna is energy. Different ✨' },
    { user: 'Chileshe', text: 'Can I say neither? 😂 jk Dave wins' },
    { user: 'Zuba', text: 'Gunna brought the melody game to a whole level' },
];
let _qaIdx = 0;

function startQALiveTicker(cardId) {
    setInterval(() => {
        const pane = document.getElementById(`qaLive_${cardId}`);
        if (!pane) return;
        const c = QA_DEMO_RESPONSES[_qaIdx % QA_DEMO_RESPONSES.length];
        const el = document.createElement('div');
        el.className = 'qa-live-msg';
        el.innerHTML = `
            <div class="qa-live-avatar">${c.user[0]}</div>
            <div class="qa-live-bubble">
                <span class="qa-live-user">${c.user}</span>
                <span class="qa-live-text">${c.text}</span>
            </div>`;
        pane.appendChild(el);
        pane.scrollTop = pane.scrollHeight;
        const msgs = pane.querySelectorAll('.qa-live-msg');
        if (msgs.length > 12) msgs[0].remove();
        _qaIdx++;
    }, 5000);
}


// Close modals when clicking outside
window.addEventListener('click', function (event) {
    const createModal = document.getElementById('createChallengeModal');
    const attemptModal = document.getElementById('attemptChallengeModal');

    if (event.target === createModal) {
        closeCreateChallengeModal();
    }

    if (event.target === attemptModal) {
        closeAttemptChallengeModal();
    }
});
