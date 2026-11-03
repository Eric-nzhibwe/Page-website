// Admin Dashboard Logic

let currentView = 'overview';
let challenges = [];
let submissions = [];
let userGeneratedContent = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check admin authentication
    if (!checkAdminAuth()) {
        window.location.href = 'admin-login.html';
        return;
    }

    loadAdminData();
    setupNavigation();
    updateDashboard();
});

// Authentication
function checkAdminAuth() {
    const currentUser = localStorage.getItem('artCurrentUser');
    if (!currentUser) return false;

    const users = JSON.parse(localStorage.getItem('artUsers') || '[]');
    const user = users.find(u => u.id === currentUser);
    
    // Check if user is admin
    return user && user.isAdmin;
}

function adminLogout() {
    if (confirm('Logout from admin panel?')) {
        window.location.href = 'admin-login.html';
    }
}

// Navigation
function setupNavigation() {
    const navBtns = document.querySelectorAll('.admin-nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            switchView(viewName);
            
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function switchView(viewName) {
    currentView = viewName;
    
    const views = document.querySelectorAll('.admin-view');
    views.forEach(view => view.classList.remove('active'));
    document.getElementById(viewName).classList.add('active');
    
    // Update title
    const titles = {
        overview: 'Dashboard Overview',
        challenges: 'Challenge Management',
        submissions: 'Challenge Submissions',
        users: 'User Management',
        ugc: 'User Generated Content'
    };
    document.getElementById('viewTitle').textContent = titles[viewName];
    
    // Load view data
    if (viewName === 'challenges') renderChallenges();
    if (viewName === 'submissions') renderSubmissions();
    if (viewName === 'users') renderUsers();
    if (viewName === 'ugc') renderUGC();
}

// Load Data
function loadAdminData() {
    challenges = JSON.parse(localStorage.getItem('artChallenges') || '[]');
    submissions = JSON.parse(localStorage.getItem('artSubmissions') || '[]');
    userGeneratedContent = JSON.parse(localStorage.getItem('artUserContent') || '[]');
}

function saveAdminData() {
    localStorage.setItem('artChallenges', JSON.stringify(challenges));
    localStorage.setItem('artSubmissions', JSON.stringify(submissions));
    localStorage.setItem('artUserContent', JSON.stringify(userGeneratedContent));
}

// Update Dashboard
function updateDashboard() {
    const users = JSON.parse(localStorage.getItem('artUsers') || '[]');
    
    document.getElementById('activeChallenges').textContent = challenges.filter(c => c.status === 'active').length;
    document.getElementById('totalUsers').textContent = users.length;
    document.getElementById('totalSubmissions').textContent = submissions.length;
    document.getElementById('userContent').textContent = userGeneratedContent.length;
    
    renderRecentActivity();
}

function renderRecentActivity() {
    const container = document.getElementById('recentActivityList');
    
    // Combine all activities
    const activities = [];
    
    challenges.slice(-5).forEach(c => {
        activities.push({
            message: `New challenge created: ${c.title}`,
            time: new Date(c.createdAt).toLocaleString(),
            timestamp: c.createdAt
        });
    });
    
    submissions.slice(-5).forEach(s => {
        activities.push({
            message: `New submission by ${s.username}`,
            time: new Date(s.submittedAt).toLocaleString(),
            timestamp: s.submittedAt
        });
    });
    
    userGeneratedContent.slice(-5).forEach(ugc => {
        activities.push({
            message: `User content uploaded by ${ugc.username}`,
            time: new Date(ugc.uploadedAt).toLocaleString(),
            timestamp: ugc.uploadedAt
        });
    });
    
    // Sort by timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    container.innerHTML = activities.slice(0, 10).map(activity => `
        <div class="activity-item-admin">
            <span>${activity.message}</span>
            <span style="color: #888; font-size: 12px;">${activity.time}</span>
        </div>
    `).join('') || '<p style="color: #888; padding: 20px;">No recent activity</p>';
}

// Challenge Management
function showCreateChallengeModal() {
    document.getElementById('createChallengeModal').style.display = 'block';
}

function closeCreateChallengeModal() {
    document.getElementById('createChallengeModal').style.display = 'none';
    document.getElementById('createChallengeForm').reset();
    document.getElementById('imagePreview').innerHTML = '';
}

function previewChallengeImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
    }
}

function createChallenge(event) {
    event.preventDefault();
    
    const title = document.getElementById('challengeTitle').value;
    const difficulty = document.getElementById('challengeDifficulty').value;
    const timeLimit = parseInt(document.getElementById('challengeTimeLimit').value);
    const challengeWindow = parseInt(document.getElementById('challengeWindow').value);
    const description = document.getElementById('challengeDescription').value;
    const submissionRules = document.getElementById('submissionRules').value;
    const minWordCount = parseInt(document.getElementById('minWordCount').value);
    const maxWordCount = parseInt(document.getElementById('maxWordCount').value);
    
    // Get scoring weights
    const creativityWeight = parseInt(document.getElementById('creativityWeight').value);
    const relevanceWeight = parseInt(document.getElementById('relevanceWeight').value);
    const detailWeight = parseInt(document.getElementById('detailWeight').value);
    
    // Validate weights sum to 100
    if (creativityWeight + relevanceWeight + detailWeight !== 100) {
        alert('Scoring weights must sum to 100%');
        return;
    }
    
    // Get image
    const imageFile = document.getElementById('challengeImage').files[0];
    if (!imageFile) {
        alert('Please upload an image prompt');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const challenge = {
            id: Date.now().toString(),
            title,
            difficulty,
            timeLimit,
            challengeWindow,
            description,
            imageUrl: e.target.result,
            submissionRules: submissionRules.split('\n').filter(r => r.trim()),
            minWordCount,
            maxWordCount,
            scoringCriteria: {
                creativity: creativityWeight,
                relevance: relevanceWeight,
                detail: detailWeight
            },
            status: 'active',
            createdAt: new Date().toISOString(),
            endsAt: new Date(Date.now() + challengeWindow * 60 * 60 * 1000).toISOString(),
            submissions: []
        };
        
        challenges.push(challenge);
        saveAdminData();
        updateDashboard();
        renderChallenges();
        closeCreateChallengeModal();
        
        alert('Challenge created successfully!');
    };
    reader.readAsDataURL(imageFile);
}

function renderChallenges() {
    const container = document.getElementById('challengesList');
    
    if (challenges.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">No challenges yet. Create your first challenge!</p>';
        return;
    }
    
    container.innerHTML = challenges.map(challenge => {
        const submissionCount = submissions.filter(s => s.challengeId === challenge.id).length;
        const timeRemaining = getTimeRemaining(challenge.endsAt);
        
        return `
            <div class="challenge-card">
                <img src="${challenge.imageUrl}" alt="${challenge.title}" class="challenge-image">
                <div class="challenge-info">
                    <h3>${challenge.title}</h3>
                    <p style="color: #aaa; margin: 10px 0;">${challenge.description}</p>
                    <div class="challenge-meta">
                        <span class="meta-item">
                            <i class="fas fa-clock"></i> ${challenge.timeLimit} min
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-calendar"></i> ${timeRemaining}
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-images"></i> ${submissionCount} submissions
                        </span>
                        <span class="difficulty-badge difficulty-${challenge.difficulty}">${challenge.difficulty}</span>
                    </div>
                </div>
                <div class="challenge-actions">
                    <button class="btn-secondary" onclick="viewChallengeDetails('${challenge.id}')">
                        <i class="fas fa-eye"></i> View
                    </button>
                    <button class="btn-secondary" onclick="toggleChallengeStatus('${challenge.id}')">
                        <i class="fas fa-${challenge.status === 'active' ? 'pause' : 'play'}"></i> 
                        ${challenge.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button class="btn-danger" onclick="deleteChallenge('${challenge.id}')">
                        <i class="fas fa-trash"></i> Delete
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
    
    if (days > 0) return `${days}d ${hours % 24}h remaining`;
    return `${hours}h remaining`;
}

function viewChallengeDetails(challengeId) {
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;
    
    alert(`Challenge: ${challenge.title}\n\nRules:\n${challenge.submissionRules.join('\n')}\n\nScoring:\n- Creativity: ${challenge.scoringCriteria.creativity}%\n- Relevance: ${challenge.scoringCriteria.relevance}%\n- Detail: ${challenge.scoringCriteria.detail}%`);
}

function toggleChallengeStatus(challengeId) {
    const challenge = challenges.find(c => c.id === challengeId);
    if (!challenge) return;
    
    challenge.status = challenge.status === 'active' ? 'paused' : 'active';
    saveAdminData();
    renderChallenges();
}

function deleteChallenge(challengeId) {
    if (!confirm('Delete this challenge? This cannot be undone.')) return;
    
    challenges = challenges.filter(c => c.id !== challengeId);
    submissions = submissions.filter(s => s.challengeId !== challengeId);
    saveAdminData();
    updateDashboard();
    renderChallenges();
}

// Submissions Management
function filterSubmissions() {
    renderSubmissions();
}

function renderSubmissions() {
    const container = document.getElementById('submissionsGrid');
    const filter = document.getElementById('submissionFilter');
    
    // Update filter options
    filter.innerHTML = '<option value="all">All Challenges</option>' + 
        challenges.map(c => `<option value="${c.id}">${c.title}</option>`).join('');
    
    const selectedChallenge = filter.value;
    let filtered = submissions;
    
    if (selectedChallenge !== 'all') {
        filtered = submissions.filter(s => s.challengeId === selectedChallenge);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; grid-column: 1/-1;">No submissions yet</p>';
        return;
    }
    
    container.innerHTML = filtered.map(submission => `
        <div class="submission-card" onclick="viewSubmissionDetails('${submission.id}')">
            <div class="submission-header">
                <span class="submission-user"><i class="fas fa-user"></i> ${submission.username}</span>
                <span class="submission-score">${submission.score || 0} pts</span>
            </div>
            <div class="submission-text">${submission.interpretation}</div>
            <div class="submission-meta">
                <span><i class="fas fa-clock"></i> ${new Date(submission.submittedAt).toLocaleString()}</span>
                <span><i class="fas fa-words"></i> ${submission.wordCount} words</span>
            </div>
        </div>
    `).join('');
}

function viewSubmissionDetails(submissionId) {
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) return;
    
    const challenge = challenges.find(c => c.id === submission.challengeId);
    
    document.getElementById('submissionDetails').innerHTML = `
        <h2>${challenge ? challenge.title : 'Challenge'}</h2>
        <div style="margin: 20px 0;">
            <strong>User:</strong> ${submission.username}<br>
            <strong>Submitted:</strong> ${new Date(submission.submittedAt).toLocaleString()}<br>
            <strong>Word Count:</strong> ${submission.wordCount}<br>
            <strong>Score:</strong> ${submission.score || 'Not scored'} pts
        </div>
        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Interpretation:</h3>
            <p style="line-height: 1.8; color: #aaa;">${submission.interpretation}</p>
        </div>
        ${challenge && challenge.imageUrl ? `<img src="${challenge.imageUrl}" style="max-width: 100%; border-radius: 8px; margin-top: 20px;">` : ''}
    `;
    
    document.getElementById('viewSubmissionModal').style.display = 'block';
}

function closeViewSubmissionModal() {
    document.getElementById('viewSubmissionModal').style.display = 'none';
}

// Users Management
function renderUsers() {
    const users = JSON.parse(localStorage.getItem('artUsers') || '[]');
    const container = document.getElementById('usersTable');
    
    if (users.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">No users registered</p>';
        return;
    }
    
    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Email</th>
                    <th>Prestige</th>
                    <th>Tier</th>
                    <th>Joined</th>
                    <th>Submissions</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(user => {
                    const userSubmissions = submissions.filter(s => s.userId === user.id).length;
                    return `
                        <tr>
                            <td>${user.username}</td>
                            <td>${user.email}</td>
                            <td>${user.prestige || 0}</td>
                            <td>${user.accessTier || 'Bronze'}</td>
                            <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                            <td>${userSubmissions}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// User Generated Content Management
function filterUGC(status) {
    // Update active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    renderUGC(status);
}

function renderUGC(filter = 'all') {
    const container = document.getElementById('ugcGrid');
    
    let filtered = userGeneratedContent;
    if (filter !== 'all') {
        filtered = userGeneratedContent.filter(ugc => ugc.status === filter);
    }
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #888; text-align: center; padding: 40px; grid-column: 1/-1;">No user content</p>';
        return;
    }
    
    container.innerHTML = filtered.map(ugc => `
        <div class="ugc-card">
            <img src="${ugc.imageUrl}" alt="${ugc.title}" class="ugc-image">
            <div class="ugc-info">
                <span class="ugc-status status-${ugc.status}">${ugc.status.toUpperCase()}</span>
                <h4>${ugc.title}</h4>
                <p style="color: #aaa; font-size: 14px; margin: 10px 0;">${ugc.description}</p>
                <div style="font-size: 12px; color: #888;">
                    <i class="fas fa-user"></i> ${ugc.username} • 
                    <i class="fas fa-clock"></i> ${new Date(ugc.uploadedAt).toLocaleDateString()}
                </div>
                ${ugc.status === 'pending' ? `
                    <div class="ugc-actions">
                        <button class="btn-approve" onclick="approveUGC('${ugc.id}')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn-reject" onclick="rejectUGC('${ugc.id}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');
}

function approveUGC(ugcId) {
    const ugc = userGeneratedContent.find(u => u.id === ugcId);
    if (!ugc) return;
    
    ugc.status = 'approved';
    saveAdminData();
    renderUGC();
    updateDashboard();
    
    alert('Content approved!');
}

function rejectUGC(ugcId) {
    const reason = prompt('Reason for rejection (optional):');
    
    const ugc = userGeneratedContent.find(u => u.id === ugcId);
    if (!ugc) return;
    
    ugc.status = 'rejected';
    ugc.rejectionReason = reason || 'Does not meet guidelines';
    saveAdminData();
    renderUGC();
    updateDashboard();
    
    alert('Content rejected');
}

// Make functions global
window.adminLogout = adminLogout;
window.showCreateChallengeModal = showCreateChallengeModal;
window.closeCreateChallengeModal = closeCreateChallengeModal;
window.previewChallengeImage = previewChallengeImage;
window.createChallenge = createChallenge;
window.viewChallengeDetails = viewChallengeDetails;
window.toggleChallengeStatus = toggleChallengeStatus;
window.deleteChallenge = deleteChallenge;
window.filterSubmissions = filterSubmissions;
window.viewSubmissionDetails = viewSubmissionDetails;
window.closeViewSubmissionModal = closeViewSubmissionModal;
window.filterUGC = filterUGC;
window.approveUGC = approveUGC;
window.rejectUGC = rejectUGC;
