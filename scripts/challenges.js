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
    currentUserId = localStorage.getItem('artCurrentUser');
    const token = localStorage.getItem('authToken');
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
        localStorage.removeItem('artCurrentUser');
        localStorage.removeItem('authToken');
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
function filterChallenges(difficulty, event) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderChallenges(difficulty);
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderChallenges(filter = 'all') {
    const container = document.getElementById('challengesGrid');
    const filtered  = filter === 'all' ? challenges : challenges.filter(c => c.difficulty === filter);

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class="fas fa-trophy"></i>
            <p>${filter === 'all' ? 'No challenges available right now.' : `No ${filter} challenges right now.`}</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const hasSubmitted = mySubmissions.some(s => s.challenge === c.id);
        return `
        <article class="challenge-card" role="listitem" data-id="${c.id}">
            <div class="challenge-image-wrap" onclick="openChallenge('${c.id}')">
                <img src="${escHtml(c.image_url)}" alt="${escHtml(c.title)}" class="challenge-image" loading="lazy">
                <div class="challenge-image-overlay"></div>
                ${c.is_featured ? '<span class="challenge-featured-tag"><i class="fas fa-star"></i> Featured</span>' : ''}
            </div>
            <div class="challenge-body" onclick="openChallenge('${c.id}')" style="cursor:pointer;">
                <div class="challenge-header">
                    <h3 class="challenge-title">${escHtml(c.title)}</h3>
                    <span class="difficulty-badge difficulty-${c.difficulty}">${c.difficulty}</span>
                </div>
                <p class="challenge-description">${escHtml(c.description)}</p>
                <div class="challenge-meta">
                    <span class="meta-item"><i class="fas fa-clock"></i> ${c.time_limit} min</span>
                    <span class="meta-item"><i class="fas fa-calendar-alt"></i> ${getTimeRemaining(c.ends_at)}</span>
                    <span class="meta-item"><i class="fas fa-users"></i> ${c.submission_count} entries</span>
                </div>
            </div>
            <div class="challenge-footer">
                <span class="reward-badge"><i class="fas fa-star"></i> ${c.min_points}–${c.max_points} pts</span>
                <div class="challenge-buttons">
                    <button class="btn-secondary" data-action="details" data-id="${c.id}">
                        <i class="fas fa-info-circle"></i> Details
                    </button>
                    <button class="btn-participate" data-action="participate" data-id="${c.id}" ${hasSubmitted ? 'disabled' : ''}>
                        ${hasSubmitted ? '<i class="fas fa-check"></i> Submitted' : '<i class="fas fa-play"></i> Participate'}
                    </button>
                </div>
            </div>
        </article>`;
    }).join('');

    // Attach button listeners after render — avoids inline handler + stopPropagation issues
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
    document.getElementById('uploadForm').reset();
    document.getElementById('createChallengeForm').reset();
    document.getElementById('uploadPreview').innerHTML = '<span><i class="fas fa-image"></i> Preview will appear here</span>';
    document.getElementById('challengeImagePreview').innerHTML = '<span><i class="fas fa-image"></i> Preview will appear here</span>';
    document.getElementById('weightTotal').textContent = 'Total: 100% ✓';
    document.getElementById('weightTotal').style.color = 'var(--accent-green)';
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
function previewChallengeImage(event) { previewImageInto(event, 'challengeImagePreview'); }
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
    const t  = (parseInt(document.getElementById('creativityWeight').value) || 0)
             + (parseInt(document.getElementById('relevanceWeight').value)  || 0)
             + (parseInt(document.getElementById('detailWeight').value)     || 0);
    const el = document.getElementById('weightTotal');
    el.style.color = t === 100 ? 'var(--accent-green)' : 'var(--accent-pink)';
    el.textContent = t === 100 ? `Total: ${t}% ✓` : `Total: ${t}% (must equal 100%)`;
}

async function createChallenge(event) {
    event.preventDefault();
    const c = parseInt(document.getElementById('creativityWeight').value) || 0;
    const r = parseInt(document.getElementById('relevanceWeight').value)  || 0;
    const d = parseInt(document.getElementById('detailWeight').value)     || 0;
    if (c + r + d !== 100) { showToast('Scoring weights must sum to 100%.', 'error'); return; }
    const img = document.getElementById('challengeImage').files[0];
    if (!img) { showToast('Please select a challenge image.', 'error'); return; }
    const btn = event.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating…'; }
    try {
        const rules = document.getElementById('challengeRules').value.split('\n').map(x => x.trim()).filter(Boolean);
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
        fd.append('submission_rules',  JSON.stringify(rules));
        fd.append('image',             img);
        fd.append('starts_at',         new Date().toISOString());
        fd.append('ends_at',           new Date(Date.now() + 7 * 86400000).toISOString());
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
function toggleMobileMenu() { document.getElementById('mainNav')?.classList.toggle('active'); }
function toggleUserMenu()   { document.getElementById('userDropdown')?.classList.toggle('active'); }
function openMessenger()    { showToast('Messenger coming soon!', 'info'); }

document.addEventListener('click', e => {
    if (!e.target.closest('.user-menu-dropdown')) document.getElementById('userDropdown')?.classList.remove('active');
});
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
window.toggleMobileMenu      = toggleMobileMenu;
window.toggleUserMenu        = toggleUserMenu;
window.openMessenger         = openMessenger;
window.showUploadModal       = showUploadModal;
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
