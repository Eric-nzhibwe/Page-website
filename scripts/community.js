// Community Page Logic

// Mobile Menu Toggle
function toggleMobileMenu() {
    const nav = document.getElementById('mainNav');
    if (nav) {
        nav.classList.toggle('active');
    }
}

let currentUserId = null;
let player = null;
let allSubmissions = [];
let currentFilter = 'all';
let currentSort = 'recent';
let currentTopFilter = 'week';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) {
        window.location.href = 'auth.html';
        return;
    }
    
    loadPlayerData();
    loadSubmissions();
    renderFeed();
    updateChallengeFilter();
});

// Authentication
function checkAuth() {
    currentUserId = localStorage.getItem('artCurrentUser');
    return currentUserId !== null;
}

function loadPlayerData() {
    if (!currentUserId) return;
    
    const saved = localStorage.getItem(`artPlayer_${currentUserId}`);
    if (saved) {
        player = JSON.parse(saved);
        
        // Initialize virtual currency if not exists
        if (player.virtualCurrency === undefined) {
            player.virtualCurrency = 0;
        }
        
        // Initialize votes if not exists
        if (!player.votes) {
            player.votes = {}; // submissionId: 'up' or 'down'
        }
        
        // Initialize rewards if not exists
        if (!player.rewards) {
            player.rewards = [];
        }
        
        savePlayerData();
        updateUI();
    }
}

function savePlayerData() {
    if (!currentUserId) return;
    localStorage.setItem(`artPlayer_${currentUserId}`, JSON.stringify(player));
    
    // Update in users array
    const users = JSON.parse(localStorage.getItem('artUsers') || '[]');
    const userIndex = users.findIndex(u => u.id === currentUserId);
    if (userIndex !== -1) {
        users[userIndex] = player;
        localStorage.setItem('artUsers', JSON.stringify(users));
    }
}

function updateUI() {
    document.getElementById('username').textContent = player.username;
    document.getElementById('userPrestige').textContent = player.prestige;
    document.getElementById('coinCount').textContent = player.virtualCurrency;
    document.getElementById('shopBalance').textContent = player.virtualCurrency;
}

function logout() {
    if (confirm('Logout?')) {
        localStorage.removeItem('artCurrentUser');
        window.location.href = 'auth.html';
    }
}

// Load Submissions
function loadSubmissions() {
    allSubmissions = JSON.parse(localStorage.getItem('artSubmissions') || '[]');
    
    // Initialize votes for each submission if not exists
    allSubmissions.forEach(submission => {
        if (!submission.votes) {
            submission.votes = {
                up: 0,
                down: 0,
                users: {} // userId: 'up' or 'down'
            };
        }
    });
    
    saveSubmissions();
}

function saveSubmissions() {
    localStorage.setItem('artSubmissions', JSON.stringify(allSubmissions));
}

// Tab Switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    // Load content
    if (tabName === 'feed') renderFeed();
    if (tabName === 'top') renderTopList();
}

// Update Challenge Filter
function updateChallengeFilter() {
    const challenges = JSON.parse(localStorage.getItem('artChallenges') || '[]');
    const select = document.getElementById('challengeFilter');
    
    select.innerHTML = '<option value="all">All Challenges</option>' +
        challenges.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
}

// Filter Feed
function filterFeed() {
    currentFilter = document.getElementById('challengeFilter').value;
    currentSort = document.getElementById('sortFilter').value;
    renderFeed();
}

// Render Feed
function renderFeed() {
    const container = document.getElementById('interpretationsGrid');
    
    let filtered = allSubmissions.filter(s => s.userId !== currentUserId); // Don't show own submissions
    
    if (currentFilter !== 'all') {
        filtered = filtered.filter(s => s.challengeId === currentFilter);
    }
    
    // Sort
    if (currentSort === 'recent') {
        filtered.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    } else if (currentSort === 'popular') {
        filtered.sort((a, b) => (b.votes.up - b.votes.down) - (a.votes.up - a.votes.down));
    } else if (currentSort === 'controversial') {
        filtered.sort((a, b) => {
            const aControversy = Math.min(a.votes.up, a.votes.down);
            const bControversy = Math.min(b.votes.up, b.votes.down);
            return bControversy - aControversy;
        });
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; grid-column: 1/-1;">No interpretations yet</p>';
        return;
    }
    
    container.innerHTML = filtered.map(submission => {
        const netVotes = submission.votes.up - submission.votes.down;
        const userVote = submission.votes.users[currentUserId];
        const timeAgo = getTimeAgo(new Date(submission.submittedAt));
        
        return `
            <div class="interpretation-card" onclick="viewInterpretation('${submission.id}')">
                <div class="interpretation-header">
                    <div class="user-avatar">
                        <div class="avatar-circle">${submission.username.charAt(0).toUpperCase()}</div>
                        <div class="user-info-card">
                            <span class="user-name">${submission.username}</span>
                            <span class="challenge-name">${submission.challengeTitle}</span>
                        </div>
                    </div>
                    <span class="score-badge">${submission.score} pts</span>
                </div>
                <div class="interpretation-text">${submission.interpretation}</div>
                <div class="interpretation-footer">
                    <div class="voting-section">
                        <button class="vote-btn ${userVote === 'up' ? 'upvoted' : ''}" onclick="vote(event, '${submission.id}', 'up')">
                            <i class="fas fa-arrow-up"></i>
                            <span class="vote-count">${submission.votes.up}</span>
                        </button>
                        <button class="vote-btn ${userVote === 'down' ? 'downvoted' : ''}" onclick="vote(event, '${submission.id}', 'down')">
                            <i class="fas fa-arrow-down"></i>
                            <span class="vote-count">${submission.votes.down}</span>
                        </button>
                        <span style="color: ${netVotes >= 0 ? '#4caf50' : '#f44336'}; font-weight: bold;">
                            ${netVotes >= 0 ? '+' : ''}${netVotes}
                        </span>
                    </div>
                    <span class="time-ago">${timeAgo}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Vote Function
function vote(event, submissionId, voteType) {
    event.stopPropagation();
    
    const submission = allSubmissions.find(s => s.id === submissionId);
    if (!submission) return;
    
    const previousVote = submission.votes.users[currentUserId];
    
    // Remove previous vote
    if (previousVote === 'up') {
        submission.votes.up--;
    } else if (previousVote === 'down') {
        submission.votes.down--;
    }
    
    // Add new vote or remove if same
    if (previousVote === voteType) {
        delete submission.votes.users[currentUserId];
    } else {
        submission.votes.users[currentUserId] = voteType;
        if (voteType === 'up') {
            submission.votes.up++;
            
            // Reward the voter with coins
            player.virtualCurrency += 1;
            
            // Reward the author with coins if high rating
            if (submission.votes.up % 5 === 0) {
                const author = JSON.parse(localStorage.getItem(`artPlayer_${submission.userId}`));
                if (author) {
                    author.virtualCurrency = (author.virtualCurrency || 0) + 5;
                    localStorage.setItem(`artPlayer_${submission.userId}`, JSON.stringify(author));
                }
            }
        } else {
            submission.votes.down++;
        }
    }
    
    saveSubmissions();
    savePlayerData();
    updateUI();
    renderFeed();
}

// View Interpretation Detail
function viewInterpretation(submissionId) {
    const submission = allSubmissions.find(s => s.id === submissionId);
    if (!submission) return;
    
    const userVote = submission.votes.users[currentUserId];
    const netVotes = submission.votes.up - submission.votes.down;
    
    document.getElementById('interpretationDetail').innerHTML = `
        <div class="interpretation-detail-header">
            <div class="detail-user-info">
                <div class="detail-avatar">${submission.username.charAt(0).toUpperCase()}</div>
                <div>
                    <h2>${submission.username}</h2>
                    <p style="color: #888;">${submission.challengeTitle}</p>
                    <p style="color: #888; font-size: 14px;">${new Date(submission.submittedAt).toLocaleString()}</p>
                </div>
            </div>
            <div class="detail-stats">
                <div class="stat-item">
                    <span class="stat-value">${submission.score}</span>
                    <span class="stat-label">Score</span>
                </div>
                <div class="stat-item">
                    <span class="stat-value" style="color: ${netVotes >= 0 ? '#4caf50' : '#f44336'}">
                        ${netVotes >= 0 ? '+' : ''}${netVotes}
                    </span>
                    <span class="stat-label">Net Votes</span>
                </div>
            </div>
        </div>
        
        <div class="detail-text">${submission.interpretation}</div>
        
        <div class="detail-voting">
            <button class="detail-vote-btn ${userVote === 'up' ? 'upvoted' : ''}" onclick="voteFromDetail('${submission.id}', 'up')">
                <i class="fas fa-arrow-up"></i>
                Upvote (${submission.votes.up})
            </button>
            <button class="detail-vote-btn ${userVote === 'down' ? 'downvoted' : ''}" onclick="voteFromDetail('${submission.id}', 'down')">
                <i class="fas fa-arrow-down"></i>
                Downvote (${submission.votes.down})
            </button>
        </div>
    `;
    
    document.getElementById('interpretationModal').style.display = 'block';
}

function voteFromDetail(submissionId, voteType) {
    vote(event, submissionId, voteType);
    viewInterpretation(submissionId); // Refresh modal
}

function closeInterpretationModal() {
    document.getElementById('interpretationModal').style.display = 'none';
}

// Top List
function filterTopBy(period) {
    currentTopFilter = period;
    
    // Update button states
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    renderTopList();
}

function renderTopList() {
    const container = document.getElementById('topList');
    
    let filtered = [...allSubmissions];
    
    // Filter by time period
    const now = new Date();
    if (currentTopFilter === 'week') {
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(s => new Date(s.submittedAt) >= weekAgo);
    } else if (currentTopFilter === 'month') {
        const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(s => new Date(s.submittedAt) >= monthAgo);
    }
    
    // Sort by net votes
    filtered.sort((a, b) => {
        const aNet = a.votes.up - a.votes.down;
        const bNet = b.votes.up - b.votes.down;
        return bNet - aNet;
    });
    
    // Take top 10
    filtered = filtered.slice(0, 10);
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">No submissions in this period</p>';
        return;
    }
    
    container.innerHTML = filtered.map((submission, index) => {
        const rank = index + 1;
        const netVotes = submission.votes.up - submission.votes.down;
        const rankClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-other';
        
        return `
            <div class="top-item" onclick="viewInterpretation('${submission.id}')">
                <div class="rank-badge ${rankClass}">
                    ${rank <= 3 ? '<i class="fas fa-trophy"></i>' : rank}
                </div>
                <div class="top-info">
                    <h3>${submission.username}</h3>
                    <p>${submission.challengeTitle}</p>
                    <p style="margin-top: 5px; font-size: 12px;">${submission.interpretation.substring(0, 100)}...</p>
                </div>
                <div class="top-stats">
                    <div class="stat-item">
                        <span class="stat-value">${submission.score}</span>
                        <span class="stat-label">Score</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color: #4caf50">${submission.votes.up}</span>
                        <span class="stat-label">Upvotes</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-value" style="color: ${netVotes >= 0 ? '#4caf50' : '#f44336'}">
                            ${netVotes >= 0 ? '+' : ''}${netVotes}
                        </span>
                        <span class="stat-label">Net</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Buy Reward
function buyReward(rewardType, cost) {
    if (player.virtualCurrency < cost) {
        alert(`Not enough coins! You need ${cost} coins but have ${player.virtualCurrency}.`);
        return;
    }
    
    if (!confirm(`Buy this reward for ${cost} coins?`)) return;
    
    player.virtualCurrency -= cost;
    
    const reward = {
        type: rewardType,
        purchasedAt: new Date().toISOString(),
        used: false
    };
    
    player.rewards.push(reward);
    
    // Apply immediate rewards
    if (rewardType === 'prestige') {
        player.prestige += 100;
    }
    
    savePlayerData();
    updateUI();
    
    const rewardNames = {
        boost: 'Challenge Boost',
        time: 'Extra Time',
        prestige: 'Prestige Boost',
        vip: 'VIP Badge',
        tier: 'Tier Skip',
        theme: 'Custom Theme'
    };
    
    alert(`✅ ${rewardNames[rewardType]} purchased successfully!`);
}

// Utility Functions
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    
    return date.toLocaleDateString();
}

// Make functions global
window.toggleMobileMenu = toggleMobileMenu;
window.logout = logout;
window.switchTab = switchTab;
window.filterFeed = filterFeed;
window.vote = vote;
window.viewInterpretation = viewInterpretation;
window.voteFromDetail = voteFromDetail;
window.closeInterpretationModal = closeInterpretationModal;
window.filterTopBy = filterTopBy;
window.buyReward = buyReward;
