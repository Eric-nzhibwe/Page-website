/**
 * Challenges Page Logic - Django Backend API
 * Features: All/Following tabs, real-time WebSocket updates, difficulty filters
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentUserId       = null;
let player              = null;
let challenges          = [];        // "All" tab data
let followingChallenges = [];        // "Following" tab data
let mySubmissions       = [];
let currentChallenge    = null;
let challengeTimer      = null;
let challengeStartTime  = null;
let activeSourceTab     = 'all';     // 'all' | 'following'
let activeDiffFilter    = 'all';

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    if (!checkAuth()) {
        window.location.href = 'auth.html';
        return;
    }
    loadPlayerData();
    initRealtimeListeners();
    await Promise.all([loadChallenges(), loadMySubmissions()]);
    renderChallenges();
    renderMySubmissions();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function checkAuth() {
    currentUserId = localStorage.getItem('artCurrentUser');
    const token   = localStorage.getItem('authToken');
    if (token) apiService.setToken(token);
    return currentUserId !== null && token !== null;
}

function loadPlayerData() {
    if (!currentUserId) return;
    const saved = localStorage.getItem(`artPlayer_${currentUserId}`);
    if (saved) { player = JSON.parse(saved); updateUI(); }
}

function updateUI() {
    if (!player) return;
    const safe = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safe('username',     player.username);
    safe('userPrestige', player.prestige_points || 0);
    safe('streakCount',  player.current_streak  || 0);
    if (player.wallet_balance !== undefined) {
        safe('walletBalance', `K${player.wallet_balance.toFixed(2)}`);
        const badge = document.getElementById('walletBalanceBadge');
        if (badge) badge.style.display = 'flex';
    }
    if (player.access_tier) safe('tierBadge', player.access_tier);
}

function logout() {
    if (confirm('Logout?')) {
        localStorage.removeItem('artCurrentUser');
        localStorage.removeItem('authToken');
        window.location.href = 'auth.html';
    }
}

// ── Real-time listeners ───────────────────────────────────────────────────────
function initRealtimeListeners() {
    // New submission → refresh the open modal's submission count
    realtimeService.on('new_submission', (data) => {
        if (currentChallenge && String(currentChallenge.id) === String(data?.challenge_id)) {
            // Bump the displayed entry count optimistically
            const countEls = document.querySelectorAll(
                `[data-id="${currentChallenge.id}"] .meta-item`
            );
            // Re-fetch leaderboard so counts stay accurate
            loadLeaderboard();
        }
        // Refresh the grid card entry-count after a short delay
        _softRefreshGrid();
    });

    // Leaderboard update → refresh the open modal's leaderboard in real time
    realtimeService.on('leaderboard_update', (data) => {
        if (currentChallenge && String(currentChallenge.id) === String(data?.challenge_id)) {
            _renderLeaderboardFromPayload(data);
        }
    });

    // Activity → append to the live feed without a full reload
    realtimeService.on('activity', (data) => {
        if (currentChallenge && String(currentChallenge.id) === String(data?.challenge_id)) {
            _prependActivityItem(data);
        }
    });

    // Polling fallback: re-fetch stats while a challenge modal is open
    realtimeService.on('poll_update', () => {
        if (currentChallenge) {
            loadLeaderboard();
            loadActivityFeed();
        }
    });
}

// ── Source tab switching (All / Following) ────────────────────────────────────
async function switchSourceTab(tab) {
    activeSourceTab = tab;

    document.querySelectorAll('.source-tab').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById(tab === 'all' ? 'tabAll' : 'tabFollowing');
    if (btn) btn.classList.add('active');

    // Reset difficulty filter buttons to "All"
    activeDiffFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const firstFilter = document.querySelector('.filter-btn');
    if (firstFilter) firstFilter.classList.add('active');

    if (tab === 'following') {
        await loadFollowingChallenges();
    }
    renderChallenges();
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadChallenges() {
    try {
        const data = await apiService.getActiveChallenges();
        challenges = Array.isArray(data) ? data : (data.results || []);
    } catch (err) {
        console.error('Error loading challenges:', err);
        challenges = [];
    }
}

async function loadFollowingChallenges() {
    const grid = document.getElementById('challengesGrid');
    if (grid) grid.innerHTML = '<p style="color:#888;text-align:center;padding:40px;grid-column:1/-1;"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';
    try {
        const data = await apiService.getFollowingChallenges();
        followingChallenges = Array.isArray(data) ? data : (data.results || []);
    } catch (err) {
        console.error('Error loading following challenges:', err);
        followingChallenges = [];
    }
}

async function loadMySubmissions() {
    try {
        const data = await apiService.getMySubmissions();
        mySubmissions = Array.isArray(data) ? data : (data.results || []);
    } catch (err) {
        mySubmissions = [];
    }
    try {
        const imgData = await apiService.getMyImageSubmissions();
        const imgSubs = Array.isArray(imgData) ? imgData : (imgData.results || []);
        imgSubs.forEach(sub => {
            if (!mySubmissions.find(s => s.challenge === sub.challenge)) {
                mySubmissions.push(sub);
            }
        });
    } catch (_) { /* non-fatal */ }
}

/** Silently refresh grid data without clearing visible content */
async function _softRefreshGrid() {
    if (activeSourceTab === 'following') {
        try {
            const data = await apiService.getFollowingChallenges();
            followingChallenges = Array.isArray(data) ? data : (data.results || []);
        } catch (_) {}
    } else {
        try {
            const data = await apiService.getActiveChallenges();
            challenges = Array.isArray(data) ? data : (data.results || []);
        } catch (_) {}
    }
    renderChallenges(activeDiffFilter);
}

// ── Filters ───────────────────────────────────────────────────────────────────
function filterChallenges(difficulty) {
    activeDiffFilter = difficulty;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (event && event.target) event.target.classList.add('active');
    renderChallenges(difficulty);
}

// ── Render helpers ────────────────────────────────────────────────────────────
function getTimeRemaining(endDate) {
    const diff = new Date(endDate) - new Date();
    if (diff <= 0) return 'Ended';
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(hours / 24);
    if (days  > 0) return `${days}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h left`;
    return 'Ending soon';
}

function _buildChallengeCard(challenge) {
    const timeRemaining = getTimeRemaining(challenge.ends_at);
    const isImgInterp   = challenge.challenge_type === 'image_interpretation';
    const hasSubmitted  = isImgInterp
        ? (challenge.user_has_img_submitted || mySubmissions.some(s => s.challenge === challenge.id))
        : mySubmissions.some(s => s.challenge === challenge.id);
    const pointsRange = `${challenge.min_points}-${challenge.max_points} pts`;
    const entryFee    = parseFloat(challenge.entry_fee   || 0);
    const prize       = parseFloat(challenge.prize_amount || 0);

    const imageHTML = isImgInterp ? `
        <div class="ii-card-img-wrap">
            <img src="${challenge.image_url}" alt="${challenge.title}" class="ii-card-img">
            <div class="ii-card-img-overlay"><i class="fas fa-lock"></i><span>Pay to reveal</span></div>
        </div>` : `
        <img src="${challenge.image_url}" alt="${challenge.title}" class="challenge-image">`;

    const prizeBadge = prize > 0
        ? `<div class="challenge-badge prize"><i class="fas fa-trophy"></i> K${prize.toFixed(2)} Prize</div>` : '';
    const entryBadge = isImgInterp && entryFee > 0
        ? `<div class="ii-entry-badge"><i class="fas fa-coins"></i> K${entryFee.toFixed(2)} Entry</div>` : '';

    // Created-by badge (shown in Following tab)
    const createdBy = challenge.created_by_username
        ? `<span class="meta-item"><i class="fas fa-user"></i> ${challenge.created_by_username}</span>` : '';

    const footerHTML = isImgInterp ? `
        <div class="challenge-footer">
            <span class="reward-badge"><i class="fas fa-star"></i> ${pointsRange}</span>
            <div class="challenge-buttons">
                <button class="btn-secondary" onclick="openImgInterpPreview('${challenge.id}');event.stopPropagation();">
                    <i class="fas fa-info-circle"></i> Details</button>
                <button class="btn-participate" ${hasSubmitted ? 'disabled' : ''}
                    onclick="openImgInterpPreview('${challenge.id}');event.stopPropagation();">
                    ${hasSubmitted ? '<i class="fas fa-check"></i> Submitted' : '<i class="fas fa-gamepad"></i> Play'}
                </button>
            </div>
        </div>` : `
        <div class="challenge-footer">
            <span class="reward-badge"><i class="fas fa-star"></i> ${pointsRange}</span>
            <div class="challenge-buttons">
                <button class="btn-secondary" onclick="viewChallengeDetails('${challenge.id}');event.stopPropagation();">
                    <i class="fas fa-info-circle"></i> Details</button>
                <button class="btn-participate" ${hasSubmitted ? 'disabled' : ''}
                    onclick="openChallenge('${challenge.id}');event.stopPropagation();">
                    ${hasSubmitted ? '<i class="fas fa-check"></i> Submitted' : 'Participate'}
                </button>
            </div>
        </div>`;

    return `
        <div class="challenge-card" data-id="${challenge.id}"
             data-challenge-type="${challenge.challenge_type || 'text_interpretation'}"
             onclick="${isImgInterp ? `openImgInterpPreview('${challenge.id}')` : `openChallenge('${challenge.id}')`}">
            ${prizeBadge}${entryBadge}${imageHTML}
            <div class="challenge-body">
                <div class="challenge-header">
                    <div>
                        <h3 class="challenge-title">${challenge.title}</h3>
                        <span class="difficulty-badge difficulty-${challenge.difficulty}">${challenge.difficulty}</span>
                        ${isImgInterp ? '<span class="difficulty-badge" style="background:#7b2fbe;color:#fff;margin-left:4px;"><i class="fas fa-image"></i> Image</span>' : ''}
                    </div>
                </div>
                <p class="challenge-description">${challenge.description}</p>
                <div class="challenge-meta">
                    <span class="meta-item"><i class="fas fa-clock"></i> ${challenge.time_limit} min</span>
                    <span class="meta-item"><i class="fas fa-calendar"></i> ${timeRemaining}</span>
                    <span class="meta-item"><i class="fas fa-users"></i> ${challenge.submission_count} entries</span>
                    ${createdBy}
                </div>
            </div>
            ${footerHTML}
        </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderChallenges(filter) {
    if (filter !== undefined) activeDiffFilter = filter;
    const container = document.getElementById('challengesGrid');
    if (!container) return;

    const pool = activeSourceTab === 'following' ? followingChallenges : challenges;
    const filtered = activeDiffFilter === 'all'
        ? pool
        : pool.filter(c => c.difficulty === activeDiffFilter);

    if (filtered.length === 0) {
        const msg = activeSourceTab === 'following'
            ? 'No challenges from people you follow yet. Follow more creators!'
            : 'No challenges available.';
        container.innerHTML = `<p style="color:#888;text-align:center;padding:40px;grid-column:1/-1;">${msg}</p>`;
        return;
    }

    container.innerHTML = filtered.map(_buildChallengeCard).join('');
}

// ── Submissions list ──────────────────────────────────────────────────────────
function renderMySubmissions() {
    const container = document.getElementById('mySubmissionsList');
    if (!container) return;

    if (mySubmissions.length === 0) {
        container.innerHTML = '<p style="color:#888;text-align:center;padding:40px;">No submissions yet. Start participating in challenges!</p>';
        return;
    }

    mySubmissions.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));

    container.innerHTML = mySubmissions.map(sub => {
        const isImg       = sub.observation_score !== undefined;
        const score       = sub.final_score || 0;
        const statusClass = sub.status === 'scored' ? 'status-scored' : 'status-pending';
        const statusIcon  = sub.status === 'scored' ? 'check' : 'clock';
        const extraInfo   = isImg
            ? `<p style="margin-top:4px;font-size:12px;color:#aaa;">
                   <i class="fas fa-eye"></i> ${sub.observation_score || 0}% observation &nbsp;·&nbsp;
                   <i class="fas fa-brain"></i> ${sub.interpretation_score || 0}% interpretation
               </p>`
            : `<p style="margin-top:5px;">${sub.word_count || 0} words</p>`;
        return `
            <div class="submission-item">
                <div class="submission-status ${statusClass}"><i class="fas fa-${statusIcon}"></i></div>
                <div class="submission-info">
                    <h4>${sub.challenge_title || 'Challenge'}</h4>
                    <p>Submitted ${new Date(sub.submitted_at).toLocaleString()}</p>
                    ${extraInfo}
                </div>
                <div class="submission-score">
                    <div class="score-value">${score}</div>
                    <div class="score-label">POINTS</div>
                </div>
            </div>`;
    }).join('');
}

// ── Open challenge modal ──────────────────────────────────────────────────────
async function openChallenge(challengeId) {
    try {
        currentChallenge = await apiService.getChallenge(challengeId);
        if (!currentChallenge) return;

        // Connect WebSocket for this challenge
        realtimeService.subscribeToChallengeUpdates(challengeId);

        const hasSubmitted = mySubmissions.some(s => s.challenge === challengeId);

        document.getElementById('challengeContent').innerHTML = `
            <h2>${currentChallenge.title}</h2>
            <span class="difficulty-badge difficulty-${currentChallenge.difficulty}">${currentChallenge.difficulty}</span>
            <img src="${currentChallenge.image_url}" alt="${currentChallenge.title}" class="challenge-detail-image">
            <p style="color:#aaa;margin:20px 0;line-height:1.8;">${currentChallenge.description}</p>
            <div class="challenge-rules">
                <h3><i class="fas fa-list"></i> Submission Rules</h3>
                <ul>${currentChallenge.submission_rules.map(r => `<li>${r}</li>`).join('')}</ul>
                <p style="margin-top:15px;color:#888;">
                    <i class="fas fa-info-circle"></i>
                    Word count: ${currentChallenge.min_word_count} – ${currentChallenge.max_word_count} words
                </p>
            </div>
            ${hasSubmitted ? `
                <div style="background:rgba(76,175,80,0.2);border:1px solid #4caf50;padding:20px;border-radius:8px;text-align:center;">
                    <i class="fas fa-check-circle" style="font-size:48px;color:#4caf50;margin-bottom:10px;"></i>
                    <h3 style="color:#4caf50;">Already submitted!</h3>
                    <p style="color:#aaa;margin-top:10px;">Check your submissions below to see your score.</p>
                </div>` : `
                <div class="timer-warning">
                    <p><i class="fas fa-clock"></i> Time Limit: ${currentChallenge.time_limit} minutes</p>
                    <div class="timer-display" id="timerDisplay">Ready to start</div>
                </div>
                <div class="submission-form">
                    <form onsubmit="submitInterpretation(event)">
                        <div class="form-group">
                            <label>Your Interpretation</label>
                            <textarea id="interpretationText" required
                                placeholder="Share your interpretation of this image…"
                                oninput="updateWordCount()"></textarea>
                            <div class="word-count" id="wordCount">0 / ${currentChallenge.max_word_count} words</div>
                        </div>
                        <button type="submit" class="btn-primary btn-large" id="submitBtn">
                            <i class="fas fa-paper-plane"></i> Submit Interpretation
                        </button>
                    </form>
                </div>`}
            <div id="leaderboardContainer" style="margin-top:40px;">
                <h3><i class="fas fa-trophy"></i> Live Leaderboard</h3>
                <div id="leaderboardContent"></div>
            </div>
            <div id="activityContainer" style="margin-top:40px;">
                <h3><i class="fas fa-fire"></i> Live Activity</h3>
                <div id="activityContent"></div>
            </div>`;

        document.getElementById('challengeModal').style.display = 'block';
        if (!hasSubmitted) { challengeStartTime = Date.now(); startChallengeTimer(); }
        loadLeaderboard();
        loadActivityFeed();
    } catch (err) {
        console.error('Error opening challenge:', err);
        alert('Error loading challenge. Please try again.');
    }
}

// ── Challenge details view (read-only) ────────────────────────────────────────
async function viewChallengeDetails(challengeId) {
    try {
        const [challenge, stats, leaderboard] = await Promise.all([
            apiService.getChallenge(challengeId),
            apiService.getChallengeStats(challengeId),
            apiService.getChallengeLeaderboard(challengeId),
        ]);

        document.getElementById('challengeContent').innerHTML = `
            <div class="challenge-details-view">
                <div class="details-header">
                    <h2>${challenge.title}</h2>
                    <span class="difficulty-badge difficulty-${challenge.difficulty}">${challenge.difficulty}</span>
                </div>
                <img src="${challenge.image_url}" alt="${challenge.title}"
                     class="challenge-detail-image" style="max-width:100%;border-radius:8px;margin:20px 0;">
                <div class="details-section">
                    <h3><i class="fas fa-align-left"></i> Description</h3>
                    <p style="color:#aaa;line-height:1.8;">${challenge.description}</p>
                </div>
                <div class="details-grid">
                    <div class="detail-card"><i class="fas fa-clock"></i><h4>Time Limit</h4><p>${challenge.time_limit} min</p></div>
                    <div class="detail-card"><i class="fas fa-star"></i><h4>Reward</h4><p>${challenge.min_points}–${challenge.max_points} pts</p></div>
                    <div class="detail-card"><i class="fas fa-users"></i><h4>Participants</h4><p>${stats.unique_participants}</p></div>
                    <div class="detail-card"><i class="fas fa-chart-bar"></i><h4>Avg Score</h4><p>${Number(stats.average_score).toFixed(1)}</p></div>
                </div>
                <div class="details-section">
                    <h3><i class="fas fa-list"></i> Submission Rules</h3>
                    <ul style="color:#aaa;line-height:2;">${challenge.submission_rules.map(r => `<li>✓ ${r}</li>`).join('')}</ul>
                </div>
                <div class="details-section">
                    <h3><i class="fas fa-pencil"></i> Requirements</h3>
                    <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;color:#aaa;">
                        <p><strong>Word Count:</strong> ${challenge.min_word_count}–${challenge.max_word_count}</p>
                        <p><strong>Difficulty:</strong> ${challenge.difficulty.toUpperCase()}</p>
                        <p><strong>Status:</strong> ${challenge.is_active ? '🟢 Active' : '🔴 Inactive'}</p>
                        <p><strong>Time Remaining:</strong> ${getTimeRemaining(challenge.ends_at)}</p>
                    </div>
                </div>
                <div class="details-section">
                    <h3><i class="fas fa-trophy"></i> Top Submissions</h3>
                    <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;">
                        ${leaderboard.top_submissions?.length ? `
                            <div style="display:grid;gap:10px;">
                                ${leaderboard.top_submissions.slice(0,5).map(e => `
                                    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(255,255,255,0.02);border-radius:6px;">
                                        <div>
                                            <span style="color:#ffd700;font-weight:bold;">#${e.rank}</span>
                                            <span style="color:#aaa;margin-left:10px;">${e.username}</span>
                                        </div>
                                        <span style="color:#4caf50;font-weight:bold;">${e.score} pts</span>
                                    </div>`).join('')}
                            </div>` : '<p style="color:#888;text-align:center;">No submissions yet</p>'}
                    </div>
                </div>
                <button class="btn-primary btn-large" onclick="openChallenge('${challenge.id}')"
                        style="width:100%;margin-top:20px;">
                    <i class="fas fa-play"></i> Participate in Challenge
                </button>
            </div>`;
        document.getElementById('challengeModal').style.display = 'block';
    } catch (err) {
        console.error('Error loading challenge details:', err);
        alert('Error loading challenge details. Please try again.');
    }
}

function closeChallengeModal() {
    document.getElementById('challengeModal').style.display = 'none';
    if (challengeTimer) { clearInterval(challengeTimer); challengeTimer = null; }
    if (currentChallenge) realtimeService.unsubscribeFromChallengeUpdates(currentChallenge.id);
    currentChallenge = null;
}

// ── Challenge timer ───────────────────────────────────────────────────────────
function startChallengeTimer() {
    let timeRemaining = currentChallenge.time_limit * 60;
    const display = document.getElementById('timerDisplay');
    challengeTimer = setInterval(() => {
        timeRemaining--;
        const m = Math.floor(timeRemaining / 60);
        const s = timeRemaining % 60;
        if (display) display.textContent = `${m}:${s.toString().padStart(2,'0')}`;
        if (timeRemaining <= 0) {
            clearInterval(challengeTimer);
            if (display) display.textContent = "Time's up!";
            const btn = document.getElementById('submitBtn');
            if (btn) btn.disabled = true;
            alert("Time's up! You can no longer submit to this challenge.");
        }
    }, 1000);
}

function updateWordCount() {
    const text  = document.getElementById('interpretationText').value;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const el    = document.getElementById('wordCount');
    if (!el) return;
    el.textContent = `${words} / ${currentChallenge.max_word_count} words`;
    el.style.color = (words < currentChallenge.min_word_count || words > currentChallenge.max_word_count)
        ? '#f44336' : '#4caf50';
}

// ── Submit interpretation ─────────────────────────────────────────────────────
async function submitInterpretation(event) {
    event.preventDefault();
    const interpretation = document.getElementById('interpretationText').value.trim();
    const words = interpretation.split(/\s+/).filter(w => w.length > 0).length;

    if (words < currentChallenge.min_word_count) {
        alert(`Too short. Minimum ${currentChallenge.min_word_count} words required.`); return;
    }
    if (words > currentChallenge.max_word_count) {
        alert(`Too long. Maximum ${currentChallenge.max_word_count} words allowed.`); return;
    }

    try {
        const seconds = Math.floor((Date.now() - challengeStartTime) / 1000);
        await apiService.submitChallenge(currentChallenge.id, interpretation, seconds);
        alert('Submission successful!');
        if (challengeTimer) { clearInterval(challengeTimer); challengeTimer = null; }
        closeChallengeModal();
        await loadMySubmissions();
        renderMySubmissions();
        renderChallenges();
    } catch (err) {
        console.error('Error submitting:', err);
        alert(`Error submitting: ${err.message}`);
    }
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
async function loadLeaderboard() {
    if (!currentChallenge) return;
    try {
        const lb = await apiService.getChallengeLeaderboard(currentChallenge.id);
        _renderLeaderboardFromPayload(lb);
    } catch (err) { console.error('Error loading leaderboard:', err); }
}

function _renderLeaderboardFromPayload(lb) {
    const container = document.getElementById('leaderboardContent');
    if (!container) return;
    const subs = lb.top_submissions || [];
    if (subs.length === 0) {
        container.innerHTML = '<p style="color:#888;">No submissions yet</p>'; return;
    }
    container.innerHTML = `
        <div style="background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;">
            <div style="display:grid;grid-template-columns:50px 1fr 100px;gap:15px;margin-bottom:15px;font-weight:bold;color:#aaa;">
                <div>Rank</div><div>Player</div><div>Score</div>
            </div>
            ${subs.map(e => `
                <div style="display:grid;grid-template-columns:50px 1fr 100px;gap:15px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="font-weight:bold;color:#ffd700;">#${e.rank}</div>
                    <div>${e.username}</div>
                    <div style="color:#4caf50;font-weight:bold;">${e.score} pts</div>
                </div>`).join('')}
        </div>
        <div style="margin-top:15px;color:#888;font-size:12px;">
            <p>Total Participants: ${lb.total_participants || 0}</p>
            <p>Average Score: ${Number(lb.average_score || 0).toFixed(1)}</p>
            <p>Highest Score: ${lb.highest_score || 0}</p>
        </div>`;
}

// ── Activity feed ─────────────────────────────────────────────────────────────
async function loadActivityFeed() {
    if (!currentChallenge) return;
    try {
        const activities = await apiService.getChallengeActivity(currentChallenge.id);
        const container  = document.getElementById('activityContent');
        if (!container) return;
        if (!activities || activities.length === 0) {
            container.innerHTML = '<p style="color:#888;">No activity yet</p>'; return;
        }
        container.innerHTML = activities.slice(0, 10).map(_activityItemHTML).join('');
    } catch (err) { console.error('Error loading activity feed:', err); }
}

/** Prepend a single activity item pushed via WebSocket */
function _prependActivityItem(data) {
    const container = document.getElementById('activityContent');
    if (!container) return;
    // Remove "no activity" placeholder if present
    if (container.querySelector('p')) container.innerHTML = '';
    // Limit to 10 visible items
    const existing = container.querySelectorAll('.activity-item-rt');
    if (existing.length >= 10) existing[existing.length - 1].remove();
    const div = document.createElement('div');
    div.className = 'activity-item-rt';
    div.innerHTML = _activityItemHTML({
        user:        { username: data.username },
        description: data.description || `${data.username} made a submission`,
        created_at:  data.created_at || new Date().toISOString(),
    });
    container.insertAdjacentHTML('afterbegin', div.innerHTML);
}

function _activityItemHTML(activity) {
    const username = activity.user?.username || activity.username || 'Someone';
    return `
        <div class="activity-item-rt"
             style="background:rgba(255,255,255,0.05);padding:12px;border-radius:6px;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <strong>${username}</strong>
                    <p style="color:#aaa;font-size:12px;margin:5px 0;">${activity.description}</p>
                </div>
                <span style="color:#888;font-size:12px;">
                    ${new Date(activity.created_at).toLocaleTimeString()}
                </span>
            </div>
        </div>`;
}

async function updateChallengeStats() {
    if (!currentChallenge) return;
    try {
        await apiService.getChallengeStats(currentChallenge.id);
        loadLeaderboard();
        loadActivityFeed();
    } catch (err) { console.error('Error updating stats:', err); }
}

// ── Upload / create challenge modal helpers ───────────────────────────────────
function showUploadModal()  { document.getElementById('uploadModal').style.display = 'block'; }
function closeUploadModal() { document.getElementById('uploadModal').style.display = 'none'; }

function switchUploadTab(tab) {
    ['contentTab','challengeTab'].forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (tab === 'content') {
        document.getElementById('contentTab')?.classList.add('active');
        document.querySelectorAll('.tab-btn')[0]?.classList.add('active');
    } else {
        document.getElementById('challengeTab')?.classList.add('active');
        document.querySelectorAll('.tab-btn')[1]?.classList.add('active');
    }
}

function validateWeights() {
    const c = parseInt(document.getElementById('creativityWeight').value) || 0;
    const r = parseInt(document.getElementById('relevanceWeight').value)  || 0;
    const d = parseInt(document.getElementById('detailWeight').value)     || 0;
    const total = c + r + d;
    const el = document.getElementById('weightTotal');
    if (!el) return;
    el.style.color   = total === 100 ? '#4caf50' : '#f44336';
    el.textContent   = total === 100 ? `Total: ${total}% ✓` : `Total: ${total}% (must be 100%)`;
}

function previewUploadImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const el = document.getElementById('uploadPreview');
        if (el) el.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width:100%;border-radius:8px;">`;
    };
    reader.readAsDataURL(file);
}

function previewChallengeImage(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        const el = document.getElementById('challengeImagePreview');
        if (el) el.innerHTML = `<img src="${e.target.result}" alt="Preview" style="max-width:100%;border-radius:8px;">`;
    };
    reader.readAsDataURL(file);
}

async function createChallenge(event) {
    event.preventDefault();
    const creativity = parseInt(document.getElementById('creativityWeight').value);
    const relevance  = parseInt(document.getElementById('relevanceWeight').value);
    const detail     = parseInt(document.getElementById('detailWeight').value);
    if (creativity + relevance + detail !== 100) { alert('Scoring weights must sum to 100%'); return; }
    const imageFile = document.getElementById('challengeImage').files[0];
    if (!imageFile) { alert('Please select an image'); return; }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            await apiService.post('/challenges/challenges/', {
                title:            document.getElementById('challengeTitle').value,
                description:      document.getElementById('challengeDescription').value,
                difficulty:       document.getElementById('challengeDifficulty').value,
                time_limit:       parseInt(document.getElementById('challengeTimeLimit').value),
                min_word_count:   parseInt(document.getElementById('challengeMinWords').value),
                max_word_count:   parseInt(document.getElementById('challengeMaxWords').value),
                submission_rules: document.getElementById('challengeRules').value.split('\n').filter(r => r.trim()),
                min_points:       parseInt(document.getElementById('challengeMinPoints').value),
                max_points:       parseInt(document.getElementById('challengeMaxPoints').value),
                creativity_weight: creativity,
                relevance_weight:  relevance,
                detail_weight:     detail,
                image_url:         e.target.result,
                status:            'active',
                starts_at:         new Date().toISOString(),
                ends_at:           new Date(Date.now() + 7 * 86400000).toISOString(),
            });
            alert('Challenge created successfully! 🎉');
            closeUploadModal();
            await loadChallenges();
            renderChallenges();
        } catch (err) {
            alert('Error creating challenge: ' + err.message);
        }
    };
    reader.readAsDataURL(imageFile);
}

// ── Misc UI helpers ───────────────────────────────────────────────────────────
function toggleMobileMenu()  {
    const nav = document.getElementById('mainNav');
    if (nav) nav.classList.toggle('active');
}
function toggleUserMenu()    {
    const d = document.getElementById('userDropdown');
    if (d) d.classList.toggle('active');
}
function toggleQuickMenu()   {
    const d = document.getElementById('quickMenuDropdown');
    if (d) d.classList.toggle('show');
}
function openMessenger()     { alert('Messenger coming soon!'); }

// ── Global exports ────────────────────────────────────────────────────────────
Object.assign(window, {
    toggleMobileMenu, toggleUserMenu, toggleQuickMenu,
    openMessenger, showUploadModal, closeUploadModal,
    switchUploadTab, validateWeights,
    previewUploadImage, previewChallengeImage, createChallenge,
    logout, filterChallenges, switchSourceTab,
    openChallenge, viewChallengeDetails, closeChallengeModal,
    updateWordCount, submitInterpretation,
    loadLeaderboard, loadActivityFeed, updateChallengeStats,
});
