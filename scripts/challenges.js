/**
 * Challenges Page Logic - Using Django Backend API
 */

// Mobile Menu Toggle
function toggleMobileMenu() {
    const nav = document.getElementById('mainNav');
    if (nav) {
        nav.classList.toggle('active');
    }
}

let currentUserId = null;
let player = null;
let challenges = [];
let mySubmissions = [];
let currentChallenge = null;
let challengeTimer = null;
let challengeStartTime = null;
let realtimeUpdateInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) {
        window.location.href = 'auth.html';
        return;
    }
    
    loadPlayerData();
    initializeRealtimeUpdates();
    loadChallenges();
    loadMySubmissions();
    renderChallenges();
    renderMySubmissions();
});

// Authentication
function checkAuth() {
    currentUserId = localStorage.getItem('artCurrentUser');
    const token = localStorage.getItem('authToken');
    
    if (token) {
        apiService.setToken(token);
    }
    
    return currentUserId !== null && token !== null;
}

function loadPlayerData() {
    if (!currentUserId) return;
    
    const saved = localStorage.getItem(`artPlayer_${currentUserId}`);
    if (saved) {
        player = JSON.parse(saved);
        updateUI();
    }
}

function updateUI() {
    if (!player) return;
    
    document.getElementById('username').textContent = player.username;
    document.getElementById('userPrestige').textContent = player.prestige_points || 0;
    document.getElementById('streakCount').textContent = player.current_streak || 0;
    
    // Update wallet balance if available
    if (player.wallet_balance !== undefined) {
        document.getElementById('walletBalance').textContent = `K${player.wallet_balance.toFixed(2)}`;
        document.getElementById('walletBalanceBadge').style.display = 'flex';
    }
    
    // Update tier badge
    if (player.access_tier) {
        document.getElementById('tierBadge').textContent = player.access_tier;
    }
}

function logout() {
    if (confirm('Logout?')) {
        localStorage.removeItem('artCurrentUser');
        localStorage.removeItem('authToken');
        window.location.href = 'auth.html';
    }
}

// Initialize Real-time Updates
function initializeRealtimeUpdates() {
    // Try to connect to WebSocket
    realtimeService.connect().catch(() => {
        console.warn('WebSocket connection failed, using polling instead');
        // Fallback to polling
        startPollingUpdates();
    });
    
    // Listen for real-time events
    realtimeService.on('new_submission', (data) => {
        console.log('New submission:', data);
        updateChallengeStats();
    });
    
    realtimeService.on('leaderboard_update', (data) => {
        console.log('Leaderboard updated:', data);
        if (currentChallenge && currentChallenge.id === data.challenge_id) {
            loadLeaderboard();
        }
    });
    
    realtimeService.on('activity', (data) => {
        console.log('New activity:', data);
        if (currentChallenge && currentChallenge.id === data.challenge_id) {
            loadActivityFeed();
        }
    });
}

function startPollingUpdates() {
    // Poll for updates every 5 seconds
    realtimeUpdateInterval = setInterval(() => {
        if (currentChallenge) {
            updateChallengeStats();
        }
    }, 5000);
}

// Load Challenges from API
async function loadChallenges() {
    try {
        const data = await apiService.getActiveChallenges();
        challenges = Array.isArray(data) ? data : data.results || [];
        console.log('Loaded challenges:', challenges);
    } catch (error) {
        console.error('Error loading challenges:', error);
        challenges = [];
    }
}

// Load User Submissions from API
async function loadMySubmissions() {
    try {
        const data = await apiService.getMySubmissions();
        mySubmissions = Array.isArray(data) ? data : data.results || [];
        console.log('Loaded submissions:', mySubmissions);
    } catch (error) {
        console.error('Error loading submissions:', error);
        mySubmissions = [];
    }
}

// Filter Challenges
function filterChallenges(difficulty) {
    // Update active filter
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    renderChallenges(difficulty);
}

// Render Challenges
function renderChallenges(filter = 'all') {
    const container = document.getElementById('challengesGrid');
    
    let filtered = challenges;
    if (filter !== 'all') {
        filtered = challenges.filter(c => c.difficulty === filter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; grid-column: 1/-1;">No challenges available</p>';
        return;
    }
    
    container.innerHTML = filtered.map(challenge => {
        const timeRemaining = getTimeRemaining(challenge.ends_at);
        const hasSubmitted = mySubmissions.some(s => s.challenge === challenge.id);
        const pointsRange = `${challenge.min_points}-${challenge.max_points} pts`;
        
        return `
            <div class="challenge-card" onclick="openChallenge('${challenge.id}')">
                <img src="${challenge.image_url}" alt="${challenge.title}" class="challenge-image">
                <div class="challenge-body">
                    <div class="challenge-header">
                        <div>
                            <h3 class="challenge-title">${challenge.title}</h3>
                            <span class="difficulty-badge difficulty-${challenge.difficulty}">${challenge.difficulty}</span>
                        </div>
                    </div>
                    <p class="challenge-description">${challenge.description}</p>
                    <div class="challenge-meta">
                        <span class="meta-item">
                            <i class="fas fa-clock"></i> ${challenge.time_limit} min
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-calendar"></i> ${timeRemaining}
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-users"></i> ${challenge.submission_count} entries
                        </span>
                    </div>
                </div>
                <div class="challenge-footer">
                    <span class="reward-badge"><i class="fas fa-star"></i> ${pointsRange}</span>
                    <button class="btn-participate" ${hasSubmitted ? 'disabled' : ''}>
                        ${hasSubmitted ? 'Submitted' : 'Participate'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getTimeRemaining(endDate) {
    const now = new Date();
    const end = new Date(endDate);
    const diff = end - now;
    
    if (diff <= 0) return 'Ended';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h left`;
    if (hours > 0) return `${hours}h left`;
    return 'Ending soon';
}

// Open Challenge
async function openChallenge(challengeId) {
    try {
        currentChallenge = await apiService.getChallenge(challengeId);
        if (!currentChallenge) return;
        
        // Subscribe to real-time updates
        realtimeService.subscribeToChallengeUpdates(challengeId);
        
        const hasSubmitted = mySubmissions.some(s => s.challenge === challengeId);
        
        document.getElementById('challengeContent').innerHTML = `
            <h2>${currentChallenge.title}</h2>
            <span class="difficulty-badge difficulty-${currentChallenge.difficulty}">${currentChallenge.difficulty}</span>
            
            <img src="${currentChallenge.image_url}" alt="${currentChallenge.title}" class="challenge-detail-image">
            
            <p style="color: #aaa; margin: 20px 0; line-height: 1.8;">${currentChallenge.description}</p>
            
            <div class="challenge-rules">
                <h3><i class="fas fa-list"></i> Submission Rules</h3>
                <ul>
                    ${currentChallenge.submission_rules.map(rule => `<li>${rule}</li>`).join('')}
                </ul>
                <p style="margin-top: 15px; color: #888;">
                    <i class="fas fa-info-circle"></i> 
                    Word count: ${currentChallenge.min_word_count} - ${currentChallenge.max_word_count} words
                </p>
            </div>
            
            ${hasSubmitted ? `
                <div style="background: rgba(76, 175, 80, 0.2); border: 1px solid #4caf50; padding: 20px; border-radius: 8px; text-align: center;">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #4caf50; margin-bottom: 10px;"></i>
                    <h3 style="color: #4caf50;">You've already submitted to this challenge!</h3>
                    <p style="color: #aaa; margin-top: 10px;">Check your submissions below to see your score.</p>
                </div>
            ` : `
                <div class="timer-warning">
                    <p><i class="fas fa-clock"></i> Time Limit: ${currentChallenge.time_limit} minutes</p>
                    <div class="timer-display" id="timerDisplay">Ready to start</div>
                </div>
                
                <div class="submission-form">
                    <form onsubmit="submitInterpretation(event)">
                        <div class="form-group">
                            <label>Your Interpretation</label>
                            <textarea id="interpretationText" required placeholder="Share your interpretation of this image..." oninput="updateWordCount()"></textarea>
                            <div class="word-count" id="wordCount">0 / ${currentChallenge.max_word_count} words</div>
                        </div>
                        
                        <button type="submit" class="btn-primary btn-large" id="submitBtn">
                            <i class="fas fa-paper-plane"></i> Submit Interpretation
                        </button>
                    </form>
                </div>
            `}
            
            <div id="leaderboardContainer" style="margin-top: 40px;">
                <h3><i class="fas fa-trophy"></i> Live Leaderboard</h3>
                <div id="leaderboardContent"></div>
            </div>
            
            <div id="activityContainer" style="margin-top: 40px;">
                <h3><i class="fas fa-fire"></i> Live Activity</h3>
                <div id="activityContent"></div>
            </div>
        `;
        
        document.getElementById('challengeModal').style.display = 'block';
        
        if (!hasSubmitted) {
            challengeStartTime = Date.now();
            startChallengeTimer();
        }
        
        // Load leaderboard and activity
        loadLeaderboard();
        loadActivityFeed();
        
    } catch (error) {
        console.error('Error opening challenge:', error);
        alert('Error loading challenge. Please try again.');
    }
}

function closeChallengeModal() {
    document.getElementById('challengeModal').style.display = 'none';
    if (challengeTimer) {
        clearInterval(challengeTimer);
        challengeTimer = null;
    }
    if (currentChallenge) {
        realtimeService.unsubscribeFromChallengeUpdates(currentChallenge.id);
    }
    currentChallenge = null;
}

// Challenge Timer
function startChallengeTimer() {
    const timeLimit = currentChallenge.time_limit * 60; // Convert to seconds
    let timeRemaining = timeLimit;
    
    const timerDisplay = document.getElementById('timerDisplay');
    
    challengeTimer = setInterval(() => {
        timeRemaining--;
        
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        
        timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (timeRemaining <= 0) {
            clearInterval(challengeTimer);
            timerDisplay.textContent = 'Time\'s up!';
            document.getElementById('submitBtn').disabled = true;
            alert('Time\'s up! You can no longer submit to this challenge.');
        }
    }, 1000);
}

// Word Count
function updateWordCount() {
    const text = document.getElementById('interpretationText').value;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    
    document.getElementById('wordCount').textContent = `${wordCount} / ${currentChallenge.max_word_count} words`;
    
    // Validate word count
    if (wordCount < currentChallenge.min_word_count || wordCount > currentChallenge.max_word_count) {
        document.getElementById('wordCount').style.color = '#f44336';
    } else {
        document.getElementById('wordCount').style.color = '#4caf50';
    }
}

// Submit Interpretation
async function submitInterpretation(event) {
    event.preventDefault();
    
    const interpretation = document.getElementById('interpretationText').value.trim();
    const words = interpretation.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    
    // Validate word count
    if (wordCount < currentChallenge.min_word_count) {
        alert(`Your interpretation is too short. Minimum ${currentChallenge.min_word_count} words required.`);
        return;
    }
    
    if (wordCount > currentChallenge.max_word_count) {
        alert(`Your interpretation is too long. Maximum ${currentChallenge.max_word_count} words allowed.`);
        return;
    }
    
    try {
        const submissionTimeSeconds = Math.floor((Date.now() - challengeStartTime) / 1000);
        
        const submission = await apiService.submitChallenge(
            currentChallenge.id,
            interpretation,
            submissionTimeSeconds
        );
        
        alert(`Submission successful! Your interpretation has been submitted.`);
        
        // Clear timer
        if (challengeTimer) {
            clearInterval(challengeTimer);
            challengeTimer = null;
        }
        
        closeChallengeModal();
        loadMySubmissions();
        renderMySubmissions();
        renderChallenges();
        
    } catch (error) {
        console.error('Error submitting interpretation:', error);
        alert(`Error submitting: ${error.message}`);
    }
}

// Load Leaderboard
async function loadLeaderboard() {
    if (!currentChallenge) return;
    
    try {
        const leaderboard = await apiService.getChallengeLeaderboard(currentChallenge.id);
        const container = document.getElementById('leaderboardContent');
        
        if (!leaderboard.top_submissions || leaderboard.top_submissions.length === 0) {
            container.innerHTML = '<p style="color: #888;">No submissions yet</p>';
            return;
        }
        
        container.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                <div style="display: grid; grid-template-columns: 50px 1fr 100px; gap: 15px; margin-bottom: 15px; font-weight: bold; color: #aaa;">
                    <div>Rank</div>
                    <div>Player</div>
                    <div>Score</div>
                </div>
                ${leaderboard.top_submissions.map(entry => `
                    <div style="display: grid; grid-template-columns: 50px 1fr 100px; gap: 15px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.1);">
                        <div style="font-weight: bold; color: #ffd700;">#${entry.rank}</div>
                        <div>${entry.username}</div>
                        <div style="color: #4caf50; font-weight: bold;">${entry.score} pts</div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 15px; color: #888; font-size: 12px;">
                <p>Total Participants: ${leaderboard.total_participants}</p>
                <p>Average Score: ${leaderboard.average_score.toFixed(1)}</p>
                <p>Highest Score: ${leaderboard.highest_score}</p>
            </div>
        `;
    } catch (error) {
        console.error('Error loading leaderboard:', error);
    }
}

// Load Activity Feed
async function loadActivityFeed() {
    if (!currentChallenge) return;
    
    try {
        const activities = await apiService.getChallengeActivity(currentChallenge.id);
        const container = document.getElementById('activityContent');
        
        if (!activities || activities.length === 0) {
            container.innerHTML = '<p style="color: #888;">No activity yet</p>';
            return;
        }
        
        container.innerHTML = activities.slice(0, 10).map(activity => `
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${activity.user.username}</strong>
                        <p style="color: #aaa; font-size: 12px; margin: 5px 0;">${activity.description}</p>
                    </div>
                    <span style="color: #888; font-size: 12px;">${new Date(activity.created_at).toLocaleTimeString()}</span>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading activity feed:', error);
    }
}

// Update Challenge Stats
async function updateChallengeStats() {
    if (!currentChallenge) return;
    
    try {
        const stats = await apiService.getChallengeStats(currentChallenge.id);
        console.log('Challenge stats:', stats);
        
        // Update leaderboard and activity if visible
        if (document.getElementById('leaderboardContent')) {
            loadLeaderboard();
        }
        if (document.getElementById('activityContent')) {
            loadActivityFeed();
        }
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Render My Submissions
function renderMySubmissions() {
    const container = document.getElementById('mySubmissionsList');
    
    if (mySubmissions.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">No submissions yet. Start participating in challenges!</p>';
        return;
    }
    
    // Sort by date (newest first)
    mySubmissions.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
    
    container.innerHTML = mySubmissions.map(submission => `
        <div class="submission-item">
            <div class="submission-status ${submission.status === 'scored' ? 'status-scored' : 'status-pending'}">
                <i class="fas fa-${submission.status === 'scored' ? 'check' : 'clock'}"></i>
            </div>
            <div class="submission-info">
                <h4>${submission.challenge_title}</h4>
                <p>Submitted ${new Date(submission.submitted_at).toLocaleString()}</p>
                <p style="margin-top: 5px;">${submission.word_count} words</p>
            </div>
            <div class="submission-score">
                <div class="score-value">${submission.final_score || 0}</div>
                <div class="score-label">POINTS</div>
            </div>
        </div>
    `).join('');
}

// Make functions global
window.toggleMobileMenu = toggleMobileMenu;
window.logout = logout;
window.filterChallenges = filterChallenges;
window.openChallenge = openChallenge;
window.closeChallengeModal = closeChallengeModal;
window.updateWordCount = updateWordCount;
window.submitInterpretation = submitInterpretation;
