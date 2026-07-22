/**
 * Challenges Page — ARTX Platform
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUserId    = null;
let player           = null;
let challenges       = [];
let mySubmissions    = [];
let currentChallenge = null;
let challengeTimer   = null;
let challengeStartTime = null;
let realtimeUpdateInterval = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) { window.location.href = 'auth.html'; return; }
    loadPlayerData();
    initializeRealtimeUpdates();
    await Promise.all([loadChallenges(), loadMySubmissions()]);
    renderChallenges();
    renderMySubmissions();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth() {
    const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    // Support both old artCurrentUser key and the current artxUser object
    const userRaw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
    currentUserId = userRaw ? (JSON.parse(userRaw)?.id || userRaw) : null;
    if (token) apiService.setToken(token);
    return currentUserId !== null && token !== null;
}

function loadPlayerData() {
    if (!currentUserId) return;
    const saved = localStorage.getItem(`artPlayer_${currentUserId}`);
    if (saved) { player = JSON.parse(saved); updateHeaderUI(); }
}

function updateHeaderUI() {
    if (!player) return;
    setEl('username', player.username);
    setEl('userPrestige', `${player.prestige_points || 0} pts`);
    setEl('streakCount', player.current_streak || 0);
    if (player.wallet_balance !== undefined) {
        setEl('walletBalance', `K${Number(player.wallet_balance).toFixed(2)}`);
        show('walletBalanceBadge');
    }
    if (player.access_tier) setEl('tierBadge', player.access_tier);
}

function logout() {
    if (confirm('Logout?')) {
        localStorage.removeItem('djangoAuthToken');
        localStorage.removeItem('authToken');
        localStorage.removeItem('artxUser');
        localStorage.removeItem('artCurrentUser');
        window.location.href = 'auth.html';
    }
}

// ── Real-time ─────────────────────────────────────────────────────────────────
function initializeRealtimeUpdates() {
    realtimeService.connect().catch(() => startPollingUpdates());
    realtimeService.on('new_submission', () => { if (currentChallenge) updateChallengeStats(); });
    realtimeService.on('leaderboard_update', d => { if (currentChallenge && currentChallenge.id === d.challenge_id) loadLeaderboard(); });
    realtimeService.on('activity', d => { if (currentChallenge && currentChallenge.id === d.challenge_id) loadActivityFeed(); });
}

function startPollingUpdates() {
    realtimeUpdateInterval = setInterval(() => { if (currentChallenge) updateChallengeStats(); }, 5000);
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadChallenges() {
    try {
        const data = await apiService.getActiveChallenges();
        challenges = Array.isArray(data) ? data : (data.results || []);
    } catch (e) { console.error('loadChallenges:', e); challenges = []; }
}

async function loadMySubmissions() {
    try {
        const data = await apiService.getMySubmissions();
        mySubmissions = Array.isArray(data) ? data : (data.results || []);
    } catch (e) { console.error('loadMySubmissions:', e); mySubmissions = []; }
}

// ── Filter ────────────────────────────────────────────────────────────────────
let _activeFilter = 'all';
let _searchQuery  = '';

function filterChallenges(difficulty, event) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    _activeFilter = difficulty;
    renderChallenges();
}

function searchChallenges(query) {
    _searchQuery = query.toLowerCase().trim();
    renderChallenges();
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderChallenges() {
    const container = document.getElementById('challengesGrid');
    let filtered = _activeFilter === 'all' ? challenges : challenges.filter(c => c.difficulty === _activeFilter);
    if (_searchQuery) {
        filtered = filtered.filter(c =>
            c.title.toLowerCase().includes(_searchQuery) ||
            (c.description || '').toLowerCase().includes(_searchQuery)
        );
    }

    // Populate hero stats
    const setHero = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setHero('statActiveChallenges', challenges.length);
    setHero('statTotalPlayers', challenges.reduce((s, c) => s + (c.submission_count || 0), 0).toLocaleString());
    setHero('statMySubmissions', mySubmissions.length);
    const raw = localStorage.getItem('artxUser') || localStorage.getItem('artCurrentUser');
    try { const u = JSON.parse(raw || '{}'); setHero('statMyPrestige', (u.prestige_points ?? 0).toLocaleString()); } catch { /* silent */ }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-trophy"></i>
            <p>${_searchQuery ? `No challenges matching "${escHtml(_searchQuery)}".` : _activeFilter === 'all' ? 'No challenges available right now.' : `No ${_activeFilter} challenges right now.`}</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const hasSubmitted = mySubmissions.some(s => s.challenge === c.id);

        // Time remaining with urgency class
        const timeLeft     = getTimeRemaining(c.ends_at);
        const timeUrgent   = timeLeft.includes('h left') && !timeLeft.includes('d');
        const timeClass    = timeUrgent ? 'meta-item time-urgent' : 'meta-item';

        // Progress bar — submissions as % of a soft cap (100 feels "full")
        const progressPct  = Math.min(100, Math.round((c.submission_count / 100) * 100));

        return `
        <article class="challenge-card ${hasSubmitted ? 'card-submitted' : ''}" role="listitem" data-id="${c.id}">

            <!-- Image banner -->
            <div class="challenge-image-wrap" onclick="openChallenge('${c.id}')">
                <img src="${escHtml(c.image_url)}" alt="${escHtml(c.title)}" class="challenge-image" loading="lazy">
                <div class="challenge-image-overlay"></div>

                <!-- Badges overlaid on image (top-left) -->
                <div class="card-overlay-badges">
                    <span class="difficulty-badge difficulty-${c.difficulty}">${c.difficulty}</span>
                    ${c.is_featured ? '<span class="card-featured-tag"><i class="fas fa-star"></i> Featured</span>' : ''}
                </div>

                <!-- Submission count pill (bottom-left) -->
                <span class="card-count-pill">
                    <i class="fas fa-users"></i> ${c.submission_count}
                </span>

                <!-- Points pill (bottom-right) -->
                <span class="card-points-pill">
                    <i class="fas fa-bolt"></i> ${c.min_points}–${c.max_points} pts
                </span>
            </div>

            <!-- Body -->
            <div class="challenge-body" onclick="openChallenge('${c.id}')">
                <h3 class="challenge-title">${escHtml(c.title)}</h3>
                <p class="challenge-description">${escHtml(c.description)}</p>

                <!-- Meta row — three equal columns -->
                <div class="challenge-meta">
                    <span class="${timeClass}">
                        <i class="fas fa-clock"></i> ${timeLeft}
                    </span>
                    <span class="meta-item">
                        <i class="fas fa-pen-nib"></i> ${c.time_limit} min
                    </span>
                    <span class="meta-item">
                        <i class="fas fa-align-left"></i> ${c.min_word_count}–${c.max_word_count}w
                    </span>
                </div>

                <!-- Participation progress bar -->
                <div class="card-progress-wrap">
                    <div class="card-progress-bar" style="width:${progressPct}%"></div>
                </div>
            </div>

            <!-- Footer actions -->
            <div class="challenge-footer">
                <button class="btn-card-details" data-action="details" data-id="${c.id}">
                    <i class="fas fa-info-circle"></i> Details
                </button>
                <button class="btn-card-participate ${hasSubmitted ? 'btn-submitted' : ''}"
                        data-action="participate" data-id="${c.id}"
                        ${hasSubmitted ? 'disabled' : ''}>
                    ${hasSubmitted
                        ? '<i class="fas fa-check-circle"></i> Submitted'
                        : '<i class="fas fa-play"></i> Participate'}
                </button>
            </div>
        </article>`;
    }).join('');

    // Attach button listeners after render
    container.querySelectorAll('[data-action="details"]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); viewChallengeDetails(btn.dataset.id); });
    });
    container.querySelectorAll('[data-action="participate"]:not([disabled])').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); openChallenge(btn.dataset.id); });
    });
}

function getTimeRemaining(endDate) {
    const diff = new Date(endDate) - Date.now();
    if (diff <= 0) return 'Ended';
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    if (days > 0)  return `${days}d ${hours}h left`;
    if (hours > 0) return `${hours}h ${mins}m left`;
    if (mins > 0)  return `${mins}m left`;
    return 'Ending soon';
}

// ── Open challenge (participate) ──────────────────────────────────────────────
async function openChallenge(challengeId) {
    document.getElementById('challengeModal').style.display = 'block';
    document.getElementById('challengeContent').innerHTML =
        `<div class="loading-state" style="grid-column:unset;"><div class="spinner"></div><p>Loading challenge…</p></div>`;
    try {
        currentChallenge = await apiService.getChallenge(challengeId);
        realtimeService.subscribeToChallengeUpdates(challengeId);
        const hasSubmitted = mySubmissions.some(s => s.challenge === challengeId);
        const rules = (currentChallenge.submission_rules || []).map(r => `<li>${escHtml(r)}</li>`).join('');

        document.getElementById('challengeContent').innerHTML = `
            <h2 style="font-size:22px;font-weight:700;margin-bottom:10px;">${escHtml(currentChallenge.title)}</h2>
            <span class="difficulty-badge difficulty-${currentChallenge.difficulty}" style="margin-bottom:14px;display:inline-block;">${currentChallenge.difficulty}</span>
            <img src="${escHtml(currentChallenge.image_url)}" alt="${escHtml(currentChallenge.title)}" class="challenge-detail-image">
            <p style="color:var(--text-secondary);line-height:1.8;margin-bottom:16px;">${escHtml(currentChallenge.description)}</p>
            <div class="challenge-rules">
                <h3><i class="fas fa-list-check"></i> Submission Rules</h3>
                <ul>${rules}</ul>
                <p style="margin-top:12px;color:var(--text-muted);font-size:13px;">
                    <i class="fas fa-info-circle"></i> Words: ${currentChallenge.min_word_count}–${currentChallenge.max_word_count}
                </p>
            </div>
            ${hasSubmitted ? buildAlreadySubmittedBox() : buildSubmissionForm(currentChallenge)}
            <div class="modal-section" id="leaderboardContainer">
                <h3><i class="fas fa-trophy"></i> Live Leaderboard</h3>
                <div id="leaderboardContent"><div class="spinner" style="margin:20px auto;"></div></div>
            </div>
            <div class="modal-section" id="activityContainer">
                <h3><i class="fas fa-bolt"></i> Live Activity</h3>
                <div id="activityContent"><div class="spinner" style="margin:20px auto;"></div></div>
            </div>`;

        if (!hasSubmitted) { challengeStartTime = Date.now(); startChallengeTimer(); }
        loadLeaderboard();
        loadActivityFeed();
    } catch (e) {
        console.error('openChallenge:', e);
        document.getElementById('challengeContent').innerHTML =
            `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load challenge. Please try again.</p></div>`;
    }
}

function buildAlreadySubmittedBox() {
    return `<div class="already-submitted-box">
        <i class="fas fa-check-circle"></i>
        <h3>Already Submitted!</h3>
        <p>Check your submissions below to see your score.</p>
    </div>`;
}

function buildSubmissionForm(c) {
    return `
        <div class="timer-warning">
            <p><i class="fas fa-clock"></i> Time Limit: ${c.time_limit} minutes</p>
            <div class="timer-display" id="timerDisplay">Ready to start</div>
        </div>
        <div class="submission-form">
            <form onsubmit="submitInterpretation(event)" novalidate>
                <div class="form-group">
                    <label for="interpretationText">Your Interpretation</label>
                    <textarea id="interpretationText" required rows="8"
                        placeholder="Share your interpretation of this image…"
                        oninput="updateWordCount()"></textarea>
                    <p class="word-count" id="wordCount">0 / ${c.max_word_count} words</p>
                </div>
                <button type="submit" class="btn-primary btn-large" id="submitBtn">
                    <i class="fas fa-paper-plane"></i> Submit Interpretation
                </button>
            </form>
        </div>`;
}

function closeChallengeModal() {
    document.getElementById('challengeModal').style.display = 'none';
    if (challengeTimer) { clearInterval(challengeTimer); challengeTimer = null; }
    if (currentChallenge) realtimeService.unsubscribeFromChallengeUpdates(currentChallenge.id);
    currentChallenge  = null;
    challengeStartTime = null;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startChallengeTimer() {
    if (!currentChallenge) return;
    let timeRemaining = currentChallenge.time_limit * 60;
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    updateTimerDisplay(display, timeRemaining);
    challengeTimer = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay(display, timeRemaining);
        if (timeRemaining <= 60) display.classList.add('urgent');
        if (timeRemaining <= 0) {
            clearInterval(challengeTimer); challengeTimer = null;
            display.textContent = "Time's up!";
            const btn = document.getElementById('submitBtn');
            if (btn) btn.disabled = true;
            showToast("Time is up! You can no longer submit.", 'error');
        }
    }, 1000);
}

function updateTimerDisplay(el, seconds) {
    el.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ── Word count ────────────────────────────────────────────────────────────────
function updateWordCount() {
    if (!currentChallenge) return;
    const text  = document.getElementById('interpretationText').value;
    const count = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const el    = document.getElementById('wordCount');
    if (!el) return;
    el.textContent = `${count} / ${currentChallenge.max_word_count} words`;
    el.className   = 'word-count ' + (count < currentChallenge.min_word_count ? 'warn' : count > currentChallenge.max_word_count ? 'bad' : 'ok');
}

// ── Submit interpretation ─────────────────────────────────────────────────────
async function submitInterpretation(event) {
    event.preventDefault();
    if (!currentChallenge) return;
    const interpretation = document.getElementById('interpretationText').value.trim();
    const wordCount = interpretation === '' ? 0 : interpretation.split(/\s+/).length;
    if (wordCount < currentChallenge.min_word_count) {
        showToast(`Too short — need at least ${currentChallenge.min_word_count} words (you have ${wordCount}).`, 'error'); return;
    }
    if (wordCount > currentChallenge.max_word_count) {
        showToast(`Too long — max ${currentChallenge.max_word_count} words (you have ${wordCount}).`, 'error'); return;
    }
    const btn = document.getElementById('submitBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting…'; }
    try {
        await apiService.submitChallenge(currentChallenge.id, interpretation, Math.floor((Date.now() - challengeStartTime) / 1000));
        if (challengeTimer) { clearInterval(challengeTimer); challengeTimer = null; }
        showToast('Interpretation submitted! Watch your submissions for your score.', 'success');
        closeChallengeModal();
        await Promise.all([loadChallenges(), loadMySubmissions()]);
        renderChallenges(); renderMySubmissions();
    } catch (e) {
        console.error('submitInterpretation:', e);
        showToast(`Submission failed: ${e.message}`, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Interpretation'; }
    }
}

// ── View challenge details ─────────────────────────────────────────────────────
async function viewChallengeDetails(challengeId) {
    document.getElementById('challengeModal').style.display = 'block';
    document.getElementById('challengeContent').innerHTML =
        `<div class="loading-state" style="grid-column:unset;"><div class="spinner"></div><p>Loading details…</p></div>`;
    try {
        const [challenge, leaderboard] = await Promise.all([
            apiService.getChallenge(challengeId),
            apiService.getChallengeLeaderboard(challengeId),
        ]);
        // Stats may not exist yet for brand-new challenges — fetch separately and default gracefully
        let stats = { unique_participants: 0, average_score: 0 };
        try { stats = await apiService.getChallengeStats(challengeId); } catch (_) { /* new challenge, no stats yet */ }

        const hasSubmitted = mySubmissions.some(s => s.challenge === challengeId);
        const rules = (challenge.submission_rules || []).map(r => `<li>${escHtml(r)}</li>`).join('');

        document.getElementById('challengeContent').innerHTML = `
            <h2 style="font-size:22px;font-weight:700;margin-bottom:10px;">${escHtml(challenge.title)}</h2>
            <span class="difficulty-badge difficulty-${challenge.difficulty}" style="margin-bottom:16px;display:inline-block;">${challenge.difficulty}</span>
            <img src="${escHtml(challenge.image_url)}" alt="${escHtml(challenge.title)}" class="challenge-detail-image">
            <div class="details-section">
                <h3><i class="fas fa-align-left"></i> Description</h3>
                <p style="color:var(--text-secondary);line-height:1.8;font-size:14px;">${escHtml(challenge.description)}</p>
            </div>
            <div class="details-grid">
                <div class="detail-card"><i class="fas fa-clock"></i><h4>Time Limit</h4><p>${challenge.time_limit} min</p></div>
                <div class="detail-card"><i class="fas fa-star"></i><h4>Reward</h4><p>${challenge.min_points}–${challenge.max_points} pts</p></div>
                <div class="detail-card"><i class="fas fa-users"></i><h4>Participants</h4><p>${stats.unique_participants || 0}</p></div>
                <div class="detail-card"><i class="fas fa-chart-bar"></i><h4>Avg Score</h4><p>${Number(stats.average_score || 0).toFixed(1)}</p></div>
            </div>
            <div class="details-section">
                <h3><i class="fas fa-list-check"></i> Rules</h3>
                <div class="challenge-rules" style="margin:0;"><ul>${rules}</ul>
                    <p style="margin-top:12px;color:var(--text-muted);font-size:13px;">
                        Words: ${challenge.min_word_count}–${challenge.max_word_count} &nbsp;|&nbsp;
                        ${challenge.is_active ? '🟢 Active' : '🔴 Inactive'} &nbsp;|&nbsp; ${getTimeRemaining(challenge.ends_at)}
                    </p>
                </div>
            </div>
            <div class="details-section">
                <h3><i class="fas fa-sliders"></i> Scoring</h3>
                <div style="background:var(--bg-elevated);padding:16px 18px;border-radius:var(--radius-md);border:1px solid var(--border);">
                    ${buildScoringBar('Creativity', challenge.creativity_weight, '#667eea')}
                    ${buildScoringBar('Relevance',  challenge.relevance_weight,  '#764ba2')}
                    ${buildScoringBar('Detail',     challenge.detail_weight,     '#f093fb')}
                </div>
            </div>
            <div class="details-section">
                <h3><i class="fas fa-trophy"></i> Top Submissions</h3>
                ${buildLeaderboardTable(leaderboard)}
            </div>
            ${hasSubmitted
                ? buildAlreadySubmittedBox()
                : `<button class="btn-primary btn-large" onclick="openChallenge('${challenge.id}')" style="margin-top:22px;">
                       <i class="fas fa-play"></i> Participate
                   </button>`}`;
    } catch (e) {
        console.error('viewChallengeDetails:', e);
        document.getElementById('challengeContent').innerHTML =
            `<div class="empty-state"><i class="fas fa-exclamation-circle"></i><p>Failed to load details.</p></div>`;
    }
}

function buildScoringBar(label, weight, color) {
    return `<div class="scoring-bar-wrap">
        <div class="scoring-bar-label"><span>${label}</span><span>${weight}%</span></div>
        <div class="scoring-bar-track"><div class="scoring-bar-fill" style="width:${weight}%;background:${color};"></div></div>
    </div>`;
}

function buildLeaderboardTable(leaderboard) {
    const entries = leaderboard.top_submissions || [];
    if (!entries.length) return `<div class="leaderboard-table"><div style="padding:24px;text-align:center;color:var(--text-muted);"><i class="fas fa-trophy" style="font-size:28px;opacity:0.3;"></i><p style="margin-top:8px;">No submissions yet</p></div></div>`;
    return `<div class="leaderboard-table">
        <div class="leaderboard-header"><div>Rank</div><div>Player</div><div>Score</div></div>
        ${entries.slice(0, 10).map(e => `
        <div class="leaderboard-row rank-${e.rank}">
            <div class="rank-num">#${e.rank}</div>
            <div>${escHtml(e.username)}</div>
            <div class="leaderboard-score">${e.score} pts</div>
        </div>`).join('')}
    </div>`;
}

// ── Leaderboard & activity (live, inside modal) ───────────────────────────────
async function loadLeaderboard() {
    if (!currentChallenge) return;
    const container = document.getElementById('leaderboardContent');
    if (!container) return;
    try {
        const lb = await apiService.getChallengeLeaderboard(currentChallenge.id);
        const entries = lb.top_submissions || [];
        if (!entries.length) { container.innerHTML = `<p style="color:var(--text-muted);padding:12px 0;">No submissions yet — be the first!</p>`; return; }
        container.innerHTML = buildLeaderboardTable(lb) + `
            <div class="leaderboard-stats">
                <div class="leaderboard-stat">Participants: <span>${lb.total_participants}</span></div>
                <div class="leaderboard-stat">Avg: <span>${Number(lb.average_score).toFixed(1)}</span></div>
                <div class="leaderboard-stat">Top: <span>${lb.highest_score}</span></div>
            </div>`;
    } catch (e) { if (container) container.innerHTML = `<p style="color:var(--text-muted);">Leaderboard unavailable.</p>`; }
}

async function loadActivityFeed() {
    if (!currentChallenge) return;
    const container = document.getElementById('activityContent');
    if (!container) return;
    try {
        const activities = await apiService.getChallengeActivity(currentChallenge.id);
        if (!activities || !activities.length) { container.innerHTML = `<p style="color:var(--text-muted);padding:12px 0;">No activity yet.</p>`; return; }
        container.innerHTML = `<div class="activity-feed">${activities.slice(0, 10).map(a => `
            <div class="activity-item">
                <div><strong>${escHtml(a.user?.username || 'Unknown')}</strong>
                    <p>${escHtml(a.description)}</p></div>
                <span class="activity-time">${formatTime(a.created_at)}</span>
            </div>`).join('')}</div>`;
    } catch (e) { if (container) container.innerHTML = `<p style="color:var(--text-muted);">Activity unavailable.</p>`; }
}

async function updateChallengeStats() {
    if (!currentChallenge) return;
    try {
        await apiService.getChallengeStats(currentChallenge.id);
        if (document.getElementById('leaderboardContent')) loadLeaderboard();
        if (document.getElementById('activityContent'))   loadActivityFeed();
    } catch (e) { /* silent */ }
}

// ── My submissions ─────────────────────────────────────────────────────────────
function renderMySubmissions() {
    const container = document.getElementById('mySubmissionsList');
    if (!mySubmissions.length) {
        container.innerHTML = `<div class="empty-state" style="grid-column:unset;"><i class="fas fa-scroll"></i><p>No submissions yet — start participating!</p></div>`;
        return;
    }
    const sorted = [...mySubmissions].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    container.innerHTML = sorted.map(s => {
        const cls  = s.status === 'scored' ? 'status-scored' : s.status === 'rejected' ? 'status-rejected' : 'status-pending';
        const icon = s.status === 'scored' ? 'check' : s.status === 'rejected' ? 'times' : 'clock';
        const col  = s.status === 'scored' ? 'var(--accent-green)' : s.status === 'rejected' ? 'var(--accent-pink)' : 'var(--accent-orange)';
        return `<div class="submission-item">
            <div class="submission-status ${cls}"><i class="fas fa-${icon}"></i></div>
            <div class="submission-info">
                <h4>${escHtml(s.challenge_title || 'Challenge')}</h4>
                <p>${formatDate(s.submitted_at)}</p>
                <p style="margin-top:3px;">${s.word_count} words &nbsp;·&nbsp;
                    <span style="text-transform:capitalize;color:${col};">${s.status}</span></p>
            </div>
            <div class="submission-score">
                <div class="score-value">${s.final_score || 0}</div>
                <div class="score-label">POINTS</div>
            </div>
        </div>`;
    }).join('');
}

// ── Upload modal ──────────────────────────────────────────────────────────────
function showUploadModal() { document.getElementById('uploadModal').style.display = 'block'; }

function closeUploadModal() {
    document.getElementById('uploadModal').style.display = 'none';
    document.getElementById('uploadForm')?.reset();
    document.getElementById('createChallengeForm')?.reset();
    // Reset image previews
    const ph = document.getElementById('ccDropPlaceholder');
    if (ph) ph.style.display = 'flex';
    const prev = document.getElementById('challengeImagePreview');
    if (prev) prev.innerHTML = '';
    document.getElementById('uploadPreview').innerHTML = '<span><i class="fas fa-image"></i> Preview will appear here</span>';
    // Reset weight indicator
    const wt = document.getElementById('weightTotal');
    if (wt) { wt.textContent = 'Total: 100% ✓'; wt.style.color = 'var(--accent-green)'; }
    // Reset wizard to step 1
    ccGoStepReset();
    // Reset duration
    _ccDurationDays = 7;
    ccSetDuration(7);
}

function ccGoStepReset() {
    document.querySelectorAll('.cc-page').forEach((p, i) => { p.classList.toggle('active', i === 0); });
    document.querySelectorAll('.cc-step').forEach((s, i) => {
        s.classList.remove('active', 'done');
        if (i === 0) s.classList.add('active');
    });
}

function switchUploadTab(tab) {
    document.getElementById('contentTab').classList.remove('active');
    document.getElementById('challengeTab').classList.remove('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'content') {
        document.getElementById('contentTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
    } else {
        document.getElementById('challengeTab').classList.add('active');
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
    }
}

function previewUploadImage(event)    { previewImageInto(event, 'uploadPreview'); }
function previewChallengeImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        ccShowError('challengeImage', 'Image must be under 5 MB.');
        return;
    }
    ccClearError('challengeImage');
    const reader = new FileReader();
    reader.onload = e => {
        const src = e.target.result;
        // Drop zone preview
        const drop = document.getElementById('ccImageDrop');
        const ph   = document.getElementById('ccDropPlaceholder');
        const prev = document.getElementById('challengeImagePreview');
        if (ph) ph.style.display = 'none';
        if (prev) { prev.innerHTML = `<img src="${src}" alt="Preview" style="max-height:220px;border-radius:8px;object-fit:cover;">`; }
        // Mini card preview
        const wrap = document.getElementById('ccPreviewImgWrap');
        if (wrap) wrap.innerHTML = `<img src="${src}" alt="Preview">`;
    };
    reader.readAsDataURL(file);
}
function previewImageInto(event, id) {
    const file = event.target.files[0];
    const el   = document.getElementById(id);
    if (!file || !el) return;
    const reader = new FileReader();
    reader.onload = e => { el.innerHTML = `<img src="${e.target.result}" alt="Preview">`; };
    reader.readAsDataURL(file);
}

async function uploadContent(event) {
    event.preventDefault();
    const title = document.getElementById('uploadTitle').value.trim();
    const desc  = document.getElementById('uploadDescription').value.trim();
    const cat   = document.getElementById('uploadCategory').value;
    const img   = document.getElementById('uploadImage').files[0];
    if (!title || !desc || !img) { showToast('Please fill in all fields and select an image.', 'error'); return; }
    const btn = event.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…'; }
    try {
        const fd = new FormData();
        fd.append('title', title); fd.append('description', desc); fd.append('category', cat); fd.append('image', img);
        await apiService.uploadContent(fd);
        showToast('Content submitted for review!', 'success');
        closeUploadModal();
    } catch (e) {
        showToast(`Upload failed: ${e.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit for Review'; }
    }
}

function validateWeights() {
    const c  = parseInt(document.getElementById('creativityWeight').value) || 0;
    const r  = parseInt(document.getElementById('relevanceWeight').value)  || 0;
    const d  = parseInt(document.getElementById('detailWeight').value)     || 0;
    const t  = c + r + d;
    const el = document.getElementById('weightTotal');
    el.style.color = t === 100 ? 'var(--accent-green)' : 'var(--accent-pink)';
    el.textContent = t === 100 ? `Total: ${t}% ✓` : `Total: ${t}% (must equal 100%)`;
    // Update visual bars
    const setBar = (id, val) => { const b = document.getElementById(id); if (b) b.style.width = val + '%'; };
    setBar('barCreativity', c);
    setBar('barRelevance',  r);
    setBar('barDetail',     d);
}

// ── Create Challenge wizard helpers ───────────────────────────────────────────
let _ccDurationDays = 7;

function ccCharCount(el, countId, max) {
    const el2 = document.getElementById(countId);
    if (!el2) return;
    const n = el.value.length;
    el2.textContent = `${n} / ${max}`;
    el2.style.color = n >= max * 0.9 ? 'var(--accent-orange)' : 'var(--text-muted)';
    // keep live preview in sync
    ccUpdatePreview();
}

function ccRuleCount() {
    const rules = (document.getElementById('challengeRules')?.value || '')
        .split('\n').map(r => r.trim()).filter(Boolean);
    const el = document.getElementById('ccRuleCountEl');
    if (el) el.textContent = `${rules.length} rule${rules.length !== 1 ? 's' : ''}`;
}

function ccClearError(fieldId) {
    const errEl = document.getElementById(fieldId + 'Err');
    if (errEl) { errEl.textContent = ''; }
    const field = document.getElementById(fieldId);
    if (field) field.style.borderColor = '';
    ccUpdatePreview();
}

function ccShowError(fieldId, msg) {
    const errEl = document.getElementById(fieldId + 'Err');
    if (errEl) errEl.textContent = msg;
    const field = document.getElementById(fieldId);
    if (field) { field.style.borderColor = 'var(--accent-pink)'; field.focus(); }
}

function ccSetDuration(days) {
    _ccDurationDays = days;
    document.querySelectorAll('.cc-dur-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.days) === days);
    });
    const customInput = document.getElementById('challengeEndsAt');
    const hint = document.getElementById('ccDurationHint');
    const label = document.getElementById('ccDurationLabel');
    if (days === 0) {
        customInput.style.display = 'block';
        if (hint) hint.style.display = 'none';
    } else {
        customInput.style.display = 'none';
        if (hint) hint.style.display = 'block';
        if (label) {
            const end = new Date(Date.now() + days * 86400000);
            label.textContent = `in ${days} day${days > 1 ? 's' : ''} — ${end.toLocaleDateString(undefined, { month:'short', day:'numeric' })}`;
        }
    }
}

function ccAutoBalance() {
    const vals = [33, 33, 34]; // creativity, relevance, detail
    document.getElementById('creativityWeight').value = vals[0];
    document.getElementById('relevanceWeight').value  = vals[1];
    document.getElementById('detailWeight').value     = vals[2];
    validateWeights();
}

function ccGoStep(step) {
    // Validate current step before advancing
    if (step > 1) {
        const page1ok = ccValidatePage1();
        if (!page1ok && step >= 2) { ccShowPageError(1); return; }
    }
    if (step > 2) {
        const page2ok = ccValidatePage2();
        if (!page2ok) { ccShowPageError(2); return; }
    }

    // Hide all pages, deactivate all steps
    document.querySelectorAll('.cc-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.cc-step').forEach(s => s.classList.remove('active', 'done'));
    document.getElementById(`ccPage${step}`)?.classList.add('active');

    // Mark steps done/active
    for (let i = 1; i <= 3; i++) {
        const s = document.getElementById(`ccStep${i}`);
        if (!s) continue;
        if (i < step)  s.classList.add('done');
        if (i === step) s.classList.add('active');
    }

    if (step === 3) ccUpdatePreview();

    // Scroll modal to top
    document.querySelector('.modal-content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function ccShowPageError(page) {
    // Scroll to first visible error on the page
    const errEl = document.querySelector(`#ccPage${page} .cc-error:not(:empty)`);
    if (errEl) errEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ccValidatePage1() {
    let ok = true;
    const title = document.getElementById('challengeTitle')?.value.trim() || '';
    const desc  = document.getElementById('challengeDescription')?.value.trim() || '';
    const time  = parseInt(document.getElementById('challengeTimeLimit')?.value || '0');
    const minPt = parseInt(document.getElementById('challengeMinPoints')?.value || '0');
    const maxPt = parseInt(document.getElementById('challengeMaxPoints')?.value || '0');

    if (!title) { ccShowError('challengeTitle', 'Title is required.'); ok = false; }
    else if (title.length < 5) { ccShowError('challengeTitle', 'Title must be at least 5 characters.'); ok = false; }

    if (!desc) { ccShowError('challengeDescription', 'Description is required.'); ok = false; }
    else if (desc.length < 20) { ccShowError('challengeDescription', 'Description must be at least 20 characters.'); ok = false; }

    if (!time || time < 5 || time > 120) { ccShowError('challengeTimeLimit', 'Enter a time between 5 and 120 minutes.'); ok = false; }
    if (!minPt || minPt < 1) { ccShowError('challengeMinPoints', 'Minimum points must be at least 1.'); ok = false; }
    if (!maxPt || maxPt <= minPt) { ccShowError('challengeMaxPoints', 'Max points must be greater than min points.'); ok = false; }

    if (_ccDurationDays === 0) {
        const custom = document.getElementById('challengeEndsAt')?.value;
        if (!custom || new Date(custom) <= new Date()) {
            ccShowError('challengeEndsAt', 'Please set a valid future end date/time.');
            ok = false;
        }
    }
    return ok;
}

function ccValidatePage2() {
    let ok = true;
    const minW = parseInt(document.getElementById('challengeMinWords')?.value || '0');
    const maxW = parseInt(document.getElementById('challengeMaxWords')?.value || '0');
    const rules = (document.getElementById('challengeRules')?.value || '').split('\n').map(r => r.trim()).filter(Boolean);
    const c = parseInt(document.getElementById('creativityWeight')?.value) || 0;
    const r = parseInt(document.getElementById('relevanceWeight')?.value)  || 0;
    const d = parseInt(document.getElementById('detailWeight')?.value)     || 0;

    if (!minW || minW < 10) { ccShowError('challengeMinWords', 'Min words must be at least 10.'); ok = false; }
    if (!maxW || maxW <= minW) { ccShowError('challengeMaxWords', 'Max words must be greater than min words.'); ok = false; }
    if (rules.length === 0) { ccShowError('challengeRules', 'Add at least one submission rule.'); ok = false; }
    if (c + r + d !== 100) {
        showToast('Scoring weights must sum to 100%.', 'error');
        ok = false;
    }
    return ok;
}

function ccUpdatePreview() {
    const get = id => document.getElementById(id);
    const setText = (id, val) => { const el = get(id); if (el) el.textContent = val || ''; };

    const title  = get('challengeTitle')?.value.trim()       || 'Challenge Title';
    const desc   = get('challengeDescription')?.value.trim() || 'Your description will appear here.';
    const diff   = get('challengeDifficulty')?.value         || 'medium';
    const time   = get('challengeTimeLimit')?.value          || '20';
    const minW   = get('challengeMinWords')?.value           || '50';
    const maxW   = get('challengeMaxWords')?.value           || '200';
    const minPt  = get('challengeMinPoints')?.value          || '10';
    const maxPt  = get('challengeMaxPoints')?.value          || '50';
    const prize  = parseFloat(get('challengePrize')?.value   || '0');

    setText('ccPreviewTitle', title);
    setText('ccPreviewDesc',  desc.length > 120 ? desc.slice(0,117) + '…' : desc);
    setText('ccPreviewTime',  time);
    setText('ccPreviewWords', `${minW}–${maxW}`);

    const diffEl = get('ccPreviewDiff');
    if (diffEl) { diffEl.textContent = diff; diffEl.className = `difficulty-badge difficulty-${diff}`; }

    const ptsEl = get('ccPreviewPts');
    if (ptsEl) ptsEl.innerHTML = `<i class="fas fa-bolt"></i> ${minPt}–${maxPt} pts`;

    const prizeRow = get('ccPreviewPrize');
    const prizeVal = get('ccPreviewPrizeVal');
    if (prizeRow) prizeRow.style.display = prize > 0 ? 'flex' : 'none';
    if (prizeVal) prizeVal.textContent = prize.toFixed(2);
}

// Drag & drop for challenge image
function ccDragOver(e) {
    e.preventDefault();
    document.getElementById('ccImageDrop')?.classList.add('cc-drag-over');
}
function ccDragLeave() {
    document.getElementById('ccImageDrop')?.classList.remove('cc-drag-over');
}
function ccDrop(e) {
    e.preventDefault();
    ccDragLeave();
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
        const dt = new DataTransfer();
        dt.items.add(file);
        document.getElementById('challengeImage').files = dt.files;
        previewChallengeImage({ target: { files: dt.files } });
    }
}

async function createChallenge(event) {
    event.preventDefault();
    // Full validation before submit
    if (!ccValidatePage1()) { ccGoStep(1); return; }
    if (!ccValidatePage2()) { ccGoStep(2); return; }

    const img = document.getElementById('challengeImage').files[0];
    if (!img) { ccShowError('challengeImage', 'Please select a challenge image.'); return; }

    const btn = document.getElementById('ccSubmitBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'; }

    try {
        const rules = document.getElementById('challengeRules').value.split('\n').map(x => x.trim()).filter(Boolean);

        // Calculate ends_at
        let endsAt;
        if (_ccDurationDays === 0) {
            endsAt = new Date(document.getElementById('challengeEndsAt').value).toISOString();
        } else {
            endsAt = new Date(Date.now() + _ccDurationDays * 86400000).toISOString();
        }

        const c = parseInt(document.getElementById('creativityWeight').value) || 0;
        const r = parseInt(document.getElementById('relevanceWeight').value)  || 0;
        const d = parseInt(document.getElementById('detailWeight').value)     || 0;
        const prize = parseFloat(document.getElementById('challengePrize')?.value || '0') || 0;

        const fd = new FormData();
        fd.append('title',             document.getElementById('challengeTitle').value.trim());
        fd.append('description',       document.getElementById('challengeDescription').value.trim());
        fd.append('difficulty',        document.getElementById('challengeDifficulty').value);
        fd.append('time_limit',        document.getElementById('challengeTimeLimit').value);
        fd.append('min_word_count',    document.getElementById('challengeMinWords').value);
        fd.append('max_word_count',    document.getElementById('challengeMaxWords').value);
        fd.append('min_points',        document.getElementById('challengeMinPoints').value);
        fd.append('max_points',        document.getElementById('challengeMaxPoints').value);
        fd.append('creativity_weight', c);
        fd.append('relevance_weight',  r);
        fd.append('detail_weight',     d);
        fd.append('prize_amount',      prize.toFixed(2));
        fd.append('submission_rules',  JSON.stringify(rules));
        fd.append('image',             img);
        fd.append('starts_at',         new Date().toISOString());
        fd.append('ends_at',           endsAt);
        fd.append('status',            'draft');

        await apiService.createChallenge(fd);
        showToast('Challenge submitted! An admin will review and activate it.', 'success');
        closeUploadModal();
        await loadChallenges(); renderChallenges();
    } catch (e) {
        showToast(`Failed to create: ${e.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-bolt"></i> Create Challenge'; }
    }
}

// ── Nav helpers ───────────────────────────────────────────────────────────────
function openMessenger() { showToast('Messenger coming soon!', 'info'); }

document.getElementById('challengeModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeChallengeModal(); });
document.getElementById('uploadModal')?.addEventListener('click',    e => { if (e.target === e.currentTarget) closeUploadModal(); });

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${icons[type]}"></i> ${escHtml(message)}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.animation = 'fadeOut 0.35s ease forwards'; toast.addEventListener('animationend', () => toast.remove()); }, 3500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function setEl(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function show(id)     { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' }) : ''; }

// ── Global exports ────────────────────────────────────────────────────────────
window.openMessenger         = openMessenger;
window.showUploadModal       = showUploadModal;
window.searchChallenges      = searchChallenges;
window.closeUploadModal      = closeUploadModal;
window.switchUploadTab       = switchUploadTab;
window.previewUploadImage    = previewUploadImage;
window.previewChallengeImage = previewChallengeImage;
window.validateWeights       = validateWeights;
window.createChallenge       = createChallenge;
window.uploadContent         = uploadContent;
window.logout                = logout;
window.filterChallenges      = filterChallenges;
window.openChallenge         = openChallenge;
window.viewChallengeDetails  = viewChallengeDetails;
window.closeChallengeModal   = closeChallengeModal;
window.updateWordCount       = updateWordCount;
window.submitInterpretation  = submitInterpretation;
// Wizard helpers
window.ccGoStep              = ccGoStep;
window.ccSetDuration         = ccSetDuration;
window.ccAutoBalance         = ccAutoBalance;
window.ccCharCount           = ccCharCount;
window.ccClearError          = ccClearError;
window.ccRuleCount           = ccRuleCount;
window.ccDragOver            = ccDragOver;
window.ccDragLeave           = ccDragLeave;
window.ccDrop                = ccDrop;
