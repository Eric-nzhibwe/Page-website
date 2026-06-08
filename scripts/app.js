// ARTX Platform - Core Logic - Django Backend Integration

// API Base URL
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

// Current User Data (loaded from Django backend)
let currentUser = null;

// Mobile Menu Toggle
function toggleMobileMenu() {
    const nav = document.getElementById('mainNav');
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    
    if (nav) {
        nav.classList.toggle('active');
    }
    
    if (toggleBtn) {
        toggleBtn.classList.toggle('active');
    }
}

// Close mobile menu when clicking outside
document.addEventListener('click', (e) => {
    const nav = document.getElementById('mainNav');
    const toggleBtn = document.querySelector('.mobile-menu-toggle');
    
    if (nav && nav.classList.contains('active')) {
        // Check if click is outside nav and toggle button
        if (!nav.contains(e.target) && !toggleBtn.contains(e.target)) {
            nav.classList.remove('active');
            if (toggleBtn) {
                toggleBtn.classList.remove('active');
            }
        }
    }
});

// Close mobile menu when nav item is clicked
document.addEventListener('DOMContentLoaded', () => {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const nav = document.getElementById('mainNav');
            const toggleBtn = document.querySelector('.mobile-menu-toggle');
            
            // Close menu on mobile
            if (window.innerWidth <= 768) {
                if (nav) nav.classList.remove('active');
                if (toggleBtn) toggleBtn.classList.remove('active');
            }
        });
    });
});

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🎮 ARTX Platform initializing...');
    
    // Clear old localStorage data
    clearOldLocalStorageData();
    
    // Check authentication and load user data
    await loadCurrentUser();
    
    if (!currentUser) {
        // Redirect to auth page if not logged in
        console.log('No authenticated user, redirecting to auth page');
        window.location.href = 'pages/auth.html';
        return;
    }
    
    // Initialize the app with user data
    initializeApp();
});

// Clear old localStorage data to force Django backend usage
function clearOldLocalStorageData() {
    const keysToRemove = [
        'artCurrentUser',
        'artUsers',
        'artPlayer_',
        'artSocialConnections_',
        'artLeaderboard',
        'artAlliances',
        'artPublicFeed'
    ];
    
    // Remove specific keys
    keysToRemove.forEach(key => {
        if (key.endsWith('_')) {
            // Remove all keys that start with this prefix
            Object.keys(localStorage).forEach(storageKey => {
                if (storageKey.startsWith(key)) {
                    localStorage.removeItem(storageKey);
                }
            });
        } else {
            localStorage.removeItem(key);
        }
    });
    
    console.log('🧹 Cleared old localStorage data - now using Django backend');
}

// Load current user from Django backend
async function loadCurrentUser() {
    const token = localStorage.getItem('djangoAuthToken');
    
    if (!token) {
        console.log('No auth token found');
        return null;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
            method: 'GET',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            currentUser = await response.json();
            console.log('User loaded from Django backend:', currentUser);
            return currentUser;
        } else {
            // Invalid token, remove it
            localStorage.removeItem('djangoAuthToken');
            console.log('Invalid auth token removed');
            return null;
        }
    } catch (error) {
        console.error('Failed to load user:', error);
        localStorage.removeItem('djangoAuthToken');
        return null;
    }
}

// Initialize app with user data
function initializeApp() {
    if (!currentUser) return;
    
    console.log('🚀 Initializing ARTX Platform for user:', currentUser.username);
    
    // Update UI with user data
    updateUserInterface();
    
    // Load wallet balance
    loadWalletBalance();
    
    // Load dynamic content
    loadLeaderboard();
    loadPublicFeed();
    loadPremiumEvents();
    loadAlliances();
    
    // Initialize event listeners
    initializeEventListeners();
    
    console.log('🎮 ARTX Platform initialized successfully!');
}

// Update user interface with current user data
function updateUserInterface() {
    if (!currentUser) return;
    
    // Update all username elements
    const usernameElements = [
        'username',  // For pages that have it
        'userMenuName',  // User menu dropdown
        'sidebarUsername',  // Left sidebar
        'postCreatorName'  // Create post modal
    ];
    
    usernameElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = currentUser.username || 'Player';
    });
    
    // Update prestige elements
    const prestigeEl = document.getElementById('userPrestige');
    const sidebarPrestige = document.getElementById('sidebarPrestige');
    const userMenuPrestige = document.getElementById('userMenuPrestige');
    
    if (prestigeEl) prestigeEl.textContent = currentUser.prestige_points || 0;
    if (sidebarPrestige) sidebarPrestige.textContent = currentUser.prestige_points || 0;
    if (userMenuPrestige) userMenuPrestige.textContent = currentUser.prestige_points || 0;
    
    // Update tier elements
    const tierEl = document.getElementById('tierBadge');
    const sidebarTier = document.getElementById('sidebarTier');
    const userMenuTier = document.getElementById('userMenuTier');
    
    const tierText = currentUser.access_tier || 'Bronze';
    const tierClass = tierText.toLowerCase();
    
    if (tierEl) {
        tierEl.textContent = `${tierText} Tier`;
        tierEl.className = `tier-badge ${tierClass}`;
    }
    if (sidebarTier) sidebarTier.textContent = `${tierText} Tier`;
    if (userMenuTier) userMenuTier.textContent = `${tierText} Tier`;
    
    // Update streak
    const streakEl = document.getElementById('streakCount');
    const userMenuStreak = document.getElementById('userMenuStreak');
    
    if (streakEl) streakEl.textContent = currentUser.current_streak || 0;
    if (userMenuStreak) userMenuStreak.textContent = currentUser.current_streak || 0;
    
    // Update rank
    const sidebarRank = document.getElementById('sidebarRank');
    if (sidebarRank) sidebarRank.textContent = currentUser.rank || '5';
    
    // Update dashboard stats
    updateDashboardStats();
    
    // Update prestige progress
    updatePrestigeProgress();
    
    // Update access tier features
    updateAccessTierFeatures();
}

// Update dashboard statistics
function updateDashboardStats() {
    if (!currentUser) return;
    
    const elements = {
        'dashPrestige': currentUser.prestige_points || 0,
        'dashStreak': currentUser.current_streak || 0,
        'dashRank': currentUser.rank || 'N/A',
        'dashSubmissions': currentUser.total_submissions || 0,
        'totalEarnings': `$${(currentUser.earnings || 0).toFixed(2)}`,
        'yourPrestigeDisplay': currentUser.prestige_points || 0,
        'yourRank': currentUser.rank || 'N/A',
        'prestigeLevel': currentUser.prestige_points || 0,
        'powerRank': currentUser.power_rank || 'Novice',
        'accessTier': currentUser.access_tier || 'Bronze'
    };
    
    Object.entries(elements).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    });
    
    // Update success rate
    const successRateEl = document.getElementById('successRate');
    if (successRateEl && currentUser.total_submissions > 0) {
        const rate = Math.round((currentUser.correct_submissions || 0) / currentUser.total_submissions * 100);
        successRateEl.textContent = rate;
    }
}

// Update prestige progress bar
function updatePrestigeProgress() {
    if (!currentUser) return;
    
    const prestige = currentUser.prestige_points || 0;
    const progressEl = document.getElementById('prestigeProgress');
    const milestoneEl = document.getElementById('nextMilestone');
    
    // Calculate next milestone
    const milestones = [100, 250, 500, 1000, 2000, 5000, 10000];
    const nextMilestone = milestones.find(m => m > prestige) || milestones[milestones.length - 1];
    const prevMilestone = milestones.filter(m => m <= prestige).pop() || 0;
    
    const progress = ((prestige - prevMilestone) / (nextMilestone - prevMilestone)) * 100;
    
    if (progressEl) {
        progressEl.style.width = `${Math.min(progress, 100)}%`;
    }
    
    if (milestoneEl) {
        milestoneEl.textContent = `Next: ${nextMilestone} pts`;
    }
}

// Update access tier features
function updateAccessTierFeatures() {
    if (!currentUser) return;
    
    const tier = currentUser.access_tier || 'Bronze';
    const prestige = currentUser.prestige_points || 0;
    
    // Update exclusive event card
    const exclusiveCard = document.getElementById('exclusiveEventCard');
    const exclusiveText = document.getElementById('exclusiveEventLockText');
    
    if (exclusiveCard && exclusiveText) {
        if (prestige >= 200) { // Silver tier
            exclusiveCard.classList.remove('locked');
            exclusiveText.textContent = 'Available!';
        } else {
            exclusiveCard.classList.add('locked');
            exclusiveText.textContent = 'Unlock at Silver Tier (200 pts)';
        }
    }
    
    // Update legendary revenue card
    const legendaryCard = document.getElementById('legendaryRevenueCard');
    if (legendaryCard) {
        if (prestige >= 5000) { // Legendary tier
            legendaryCard.classList.remove('locked');
        } else {
            legendaryCard.classList.add('locked');
        }
    }
    
    // Update rank benefits
    const rankBenefitsEl = document.getElementById('rankBenefits');
    if (rankBenefitsEl) {
        const tierBenefits = {
            'Bronze': '+3 opportunities',
            'Silver': '+5 opportunities',
            'Gold': '+8 opportunities',
            'Platinum': '+12 opportunities',
            'Diamond': '+20 opportunities',
            'Elite': '+50 opportunities',
            'Legendary': '+100 opportunities'
        };
        rankBenefitsEl.textContent = tierBenefits[tier] || '+3 opportunities';
    }
    
    // Update tier unlock info
    const tierUnlockEl = document.getElementById('tierUnlock');
    if (tierUnlockEl) {
        const tierEvents = {
            'Bronze': '2 events unlocked',
            'Silver': '4 events unlocked',
            'Gold': '6 events unlocked',
            'Platinum': '10 events unlocked',
            'Diamond': '15 events unlocked',
            'Elite': '25 events unlocked',
            'Legendary': 'All events unlocked'
        };
        tierUnlockEl.textContent = tierEvents[tier] || '2 events unlocked';
    }
}

// Load leaderboard from Django backend
async function loadLeaderboard() {
    try {
        const token = localStorage.getItem('djangoAuthToken');
        const response = await fetch(`${API_BASE_URL}/tournaments/leaderboard/`, {
            method: 'GET',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const leaderboard = await response.json();
            renderLeaderboard(leaderboard);
        } else {
            console.error('Failed to load leaderboard');
            // Use fallback data
            renderLeaderboard([
                { username: 'SkillMaster', prestige_points: 2450, rank: 1 },
                { username: 'ProGamer', prestige_points: 1890, rank: 2 },
                { username: 'EliteWarrior', prestige_points: 1650, rank: 3 },
                { username: currentUser?.username || 'You', prestige_points: currentUser?.prestige_points || 0, rank: 4 }
            ]);
        }
    } catch (error) {
        console.error('Error loading leaderboard:', error);
        // Use fallback data
        renderLeaderboard([
            { username: 'SkillMaster', prestige_points: 2450, rank: 1 },
            { username: 'ProGamer', prestige_points: 1890, rank: 2 },
            { username: 'EliteWarrior', prestige_points: 1650, rank: 3 },
            { username: currentUser?.username || 'You', prestige_points: currentUser?.prestige_points || 0, rank: 4 }
        ]);
    }
}

// Render leaderboard
function renderLeaderboard(leaderboard) {
    const ladderEl = document.getElementById('rankLadder');
    if (!ladderEl) return;
    
    ladderEl.innerHTML = '';
    
    leaderboard.forEach((player, index) => {
        const rank = player.rank || (index + 1);
        const isCurrentUser = player.username === currentUser?.username;
        
        const playerEl = document.createElement('div');
        playerEl.className = `ladder-player ${isCurrentUser ? 'current-user' : ''}`;
        playerEl.innerHTML = `
            <span class="player-rank">#${rank}</span>
            <span class="player-name">${player.username}</span>
            <span class="player-prestige">${player.prestige_points || 0} pts</span>
        `;
        
        ladderEl.appendChild(playerEl);
    });
    
    // Update leaderboard list for compete view
    const leaderboardListEl = document.getElementById('leaderboardList');
    if (leaderboardListEl) {
        leaderboardListEl.innerHTML = '';
        leaderboard.slice(0, 10).forEach((player, index) => {
            const rank = player.rank || (index + 1);
            const isCurrentUser = player.username === currentUser?.username;
            
            const playerEl = document.createElement('div');
            playerEl.className = `leaderboard-item ${isCurrentUser ? 'current-user' : ''}`;
            playerEl.innerHTML = `
                <span class="rank">#${rank}</span>
                <span class="name">${player.username}</span>
                <span class="prestige">${player.prestige_points || 0}</span>
            `;
            
            leaderboardListEl.appendChild(playerEl);
        });
    }
}

// Load public feed (placeholder - will be implemented with real data later)
function loadPublicFeed() {
    const feedEl = document.getElementById('publicFeed');
    if (!feedEl) return;
    
    // Placeholder feed data
    const feedItems = [
        { user: 'EliteWarrior', action: 'won a tournament', time: '2 min ago', prestige: '+150' },
        { user: 'ProGamer', action: 'joined Elite Warriors alliance', time: '5 min ago', prestige: '+25' },
        { user: 'SkillMaster', action: 'reached Diamond tier', time: '10 min ago', prestige: '+500' },
        { user: currentUser?.username || 'You', action: 'joined the platform', time: 'Just now', prestige: '+10' }
    ];
    
    feedEl.innerHTML = '';
    
    feedItems.forEach(item => {
        const feedItem = document.createElement('div');
        feedItem.className = 'feed-item';
        feedItem.innerHTML = `
            <div class="feed-content">
                <strong>${item.user}</strong> ${item.action}
                <span class="feed-time">${item.time}</span>
            </div>
            <div class="feed-prestige">${item.prestige}</div>
        `;
        feedEl.appendChild(feedItem);
    });
    
    // Update activity feed
    const activityFeedEl = document.getElementById('activityFeed');
    if (activityFeedEl) {
        activityFeedEl.innerHTML = '';
        feedItems.slice(0, 5).forEach(item => {
            const activityItem = document.createElement('div');
            activityItem.className = 'activity-item';
            activityItem.innerHTML = `
                <div class="activity-content">
                    <strong>${item.user}</strong> ${item.action}
                </div>
                <div class="activity-time">${item.time}</div>
            `;
            activityFeedEl.appendChild(activityItem);
        });
    }
}

// Load premium events
function loadPremiumEvents() {
    const eventsEl = document.getElementById('premiumEvents');
    if (!eventsEl) return;
    
    const events = [
        { 
            name: 'Weekend Blitz', 
            prize: 1000, 
            requirement: 'Silver Tier', 
            minPrestige: 200,
            countdown: '2d 5h',
            status: 'upcoming'
        },
        { 
            name: 'Elite Championship', 
            prize: 5000, 
            requirement: 'Gold Tier', 
            minPrestige: 500,
            countdown: '5d 12h',
            status: 'locked'
        },
        { 
            name: 'Grand Masters', 
            prize: 10000, 
            requirement: 'Platinum Tier', 
            minPrestige: 1000,
            countdown: '7d 3h',
            status: 'locked'
        }
    ];
    
    eventsEl.innerHTML = '';
    
    events.forEach(event => {
        const canParticipate = (currentUser?.prestige_points || 0) >= event.minPrestige;
        
        const eventEl = document.createElement('div');
        eventEl.className = `event-card ${canParticipate ? 'available' : 'locked'}`;
        eventEl.innerHTML = `
            <h3>${event.name}</h3>
            <div class="event-prize">$${event.prize}</div>
            <div class="event-requirement">${event.requirement}</div>
            <div class="event-countdown">${event.countdown}</div>
            <button class="btn-primary" ${canParticipate ? '' : 'disabled'}>
                ${canParticipate ? 'Enter' : 'Locked'}
            </button>
        `;
        eventsEl.appendChild(eventEl);
    });
}

// Load alliances
function loadAlliances() {
    const availableAlliancesEl = document.getElementById('availableAlliances');
    if (!availableAlliancesEl) return;
    
    const alliances = [
        { name: 'Elite Warriors', members: 12, power: 5600, description: 'For the elite gamers' },
        { name: 'Shadow Legends', members: 8, power: 4200, description: 'Masters of stealth gaming' },
        { name: 'Phoenix Rising', members: 15, power: 7800, description: 'Rising from the ashes' }
    ];
    
    availableAlliancesEl.innerHTML = '';
    
    alliances.forEach(alliance => {
        const allianceEl = document.createElement('div');
        allianceEl.className = 'alliance-item';
        allianceEl.innerHTML = `
            <div class="alliance-info">
                <h4>${alliance.name}</h4>
                <p>${alliance.description}</p>
                <div class="alliance-stats">
                    <span>👥 ${alliance.members} members</span>
                    <span>⚡ ${alliance.power} power</span>
                </div>
            </div>
            <button class="btn-primary" onclick="joinAlliance('${alliance.name}')">Join</button>
        `;
        availableAlliancesEl.appendChild(allianceEl);
    });
    
    // Update alliance display
    const allianceDisplayEl = document.getElementById('allianceDisplay');
    if (allianceDisplayEl) {
        if (currentUser?.alliance) {
            allianceDisplayEl.innerHTML = `
                <div class="current-alliance">
                    <h4>${currentUser.alliance}</h4>
                    <p>You are a member of this alliance</p>
                </div>
            `;
        } else {
            allianceDisplayEl.innerHTML = '<p class="no-alliance">No alliance yet. Form one to gain bonuses!</p>';
        }
    }
}

// Initialize event listeners
function initializeEventListeners() {
    // Modal close listeners
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
        if (e.target.classList.contains('close')) {
            e.target.closest('.modal').style.display = 'none';
        }
    });
    
    // Navigation listeners
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const view = e.target.getAttribute('data-view');
            if (view) {
                showView(view);
            }
        });
    });
}

// Show specific view
function showView(viewName) {
    // Hide all views
    const views = document.querySelectorAll('.view');
    views.forEach(view => view.classList.remove('active'));
    
    // Show selected view
    const targetView = document.getElementById(viewName);
    if (targetView) {
        targetView.classList.add('active');
    }
    
    // Update navigation
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === viewName) {
            btn.classList.add('active');
        }
    });
}

// Submit answer function
async function submitAnswer() {
    const answerInput = document.getElementById('answerInput');
    if (!answerInput) return;
    
    const answer = answerInput.value.trim();
    if (!answer) {
        alert('Please enter an answer!');
        return;
    }
    
    try {
        const token = localStorage.getItem('djangoAuthToken');
        const response = await fetch(`${API_BASE_URL}/auth/submit-answer/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                answer: answer,
                challenge_id: 1 // Default challenge
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            alert(data.message || 'Answer submitted successfully!');
            answerInput.value = '';
            
            // Reload user data to update stats
            await loadCurrentUser();
            updateUserInterface();
        } else {
            alert('Failed to submit answer. Please try again.');
        }
    } catch (error) {
        console.error('Error submitting answer:', error);
        alert('Answer submitted! (Demo mode - Django backend integration in progress)');
        answerInput.value = '';
    }
}

// Alliance functions
function showAllianceModal() {
    const modal = document.getElementById('allianceModal');
    if (modal) {
        modal.style.display = 'block';
        loadAlliances(); // Refresh alliance list
    }
}

function closeAllianceModal() {
    const modal = document.getElementById('allianceModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showAllianceTab(tabName) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.tab-content');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => btn.classList.remove('active'));
    
    // Show selected tab
    const targetTab = document.getElementById(`${tabName}AllianceTab`);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    
    // Update button
    const targetButton = document.querySelector(`[onclick="showAllianceTab('${tabName}')"]`);
    if (targetButton) {
        targetButton.classList.add('active');
    }
}

function createAlliance() {
    const nameInput = document.getElementById('allianceName');
    if (!nameInput) return;
    
    const name = nameInput.value.trim();
    if (!name) {
        alert('Please enter an alliance name!');
        return;
    }
    
    // Placeholder - will integrate with Django backend
    alert(`Alliance "${name}" created! (Django backend integration coming soon)`);
    nameInput.value = '';
    closeAllianceModal();
}

function joinAlliance(allianceName) {
    alert(`Joined ${allianceName}! (Django backend integration coming soon)`);
    closeAllianceModal();
}

// Cashout functions
function cashOut() {
    const modal = document.getElementById('cashoutModal');
    if (modal) {
        modal.style.display = 'block';
        
        // Update cashout amount
        const amountEl = document.getElementById('cashoutAmount');
        if (amountEl && currentUser) {
            amountEl.textContent = `$${(currentUser.earnings || 0).toFixed(2)}`;
        }
    }
}

function closeCashoutModal() {
    const modal = document.getElementById('cashoutModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function setMaxAmount() {
    const amountInput = document.getElementById('cashoutWithdrawAmount');
    if (amountInput && currentUser) {
        amountInput.value = (currentUser.earnings || 0).toFixed(2);
    }
}

function submitCashout() {
    const provider = document.getElementById('cashoutProvider').value;
    const phone = document.getElementById('cashoutPhone').value;
    const currency = document.getElementById('cashoutCurrency').value;
    const amount = document.getElementById('cashoutWithdrawAmount').value;
    
    if (!phone || !amount) {
        alert('Please fill in all required fields!');
        return;
    }
    
    // Placeholder - will integrate with Django backend
    alert(`Cashout request submitted!\nProvider: ${provider}\nAmount: ${amount} ${currency}\nPhone: ${phone}\n\n(Django backend integration coming soon)`);
    closeCashoutModal();
}

// Tournament functions
function enterTournament(tournamentType) {
    alert(`Entered ${tournamentType} tournament! (Django backend integration coming soon)`);
}

function startChallenge(difficulty) {
    alert(`Started ${difficulty} challenge! (Django backend integration coming soon)`);
}

// Family functions
function inviteFamily() {
    const email = prompt('Enter family member email:');
    if (email) {
        alert(`Invitation sent to ${email}! (Django backend integration coming soon)`);
    }
}

// Filter functions
function filterHistory(type) {
    // Update filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(type) || type === 'all') {
            btn.classList.add('active');
        }
    });
    
    // Placeholder - will implement with real data
    console.log(`Filtering history by: ${type}`);
}

// Logout function
function logout() {
    if (confirm('Are you sure you want to logout?')) {
        // Remove auth token
        localStorage.removeItem('djangoAuthToken');
        
        // Clear user data
        currentUser = null;
        
        // Redirect to auth page
        window.location.href = 'pages/auth.html';
    }
}

// Make functions global
window.toggleMobileMenu = toggleMobileMenu;
window.submitAnswer = submitAnswer;
window.showAllianceModal = showAllianceModal;
window.closeAllianceModal = closeAllianceModal;
window.showAllianceTab = showAllianceTab;
window.createAlliance = createAlliance;
window.joinAlliance = joinAlliance;
window.cashOut = cashOut;
window.closeCashoutModal = closeCashoutModal;
window.setMaxAmount = setMaxAmount;
window.submitCashout = submitCashout;
window.enterTournament = enterTournament;
window.startChallenge = startChallenge;
window.inviteFamily = inviteFamily;
window.filterHistory = filterHistory;
window.logout = logout;
window.showView = showView;

// Navigate to profile page
function viewProfile() {
    window.location.href = '/pages/user.html';
}
window.viewProfile = viewProfile;

// Load user profile for navbar display (used by messenger and other pages)
async function loadUserProfile() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return;
    try {
        const res = await fetch(`${API_BASE_URL}/auth/profile/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (res.ok) {
            const user = await res.json();
            const navUsername = document.getElementById('navUsername');
            if (navUsername) navUsername.textContent = user.display_name || user.username;
        }
    } catch (e) { /* silent */ }
}
window.loadUserProfile = loadUserProfile;


// ==================== MESSENGER FUNCTIONALITY ====================

let currentConversation = null;
let conversations = [];
let messages = {};

// Toggle User Menu Dropdown
function toggleUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
window.addEventListener('click', function(event) {
    if (!event.target.matches('.btn-user-menu') && !event.target.closest('.btn-user-menu')) {
        const dropdowns = document.getElementsByClassName('dropdown-content');
        for (let dropdown of dropdowns) {
            if (dropdown.classList.contains('show')) {
                dropdown.classList.remove('show');
            }
        }
    }
});

// Open Messenger
function openMessenger() {
    const modal = document.getElementById('messengerModal');
    const splash = document.getElementById('messengerSplash');
    const content = document.getElementById('messengerContent');
    
    // Show modal
    modal.style.display = 'block';
    
    // Show splash screen
    splash.style.display = 'flex';
    content.style.display = 'none';
    
    // After 2.5 seconds, fade out splash and show messenger
    setTimeout(() => {
        splash.classList.add('fade-out');
        
        // After fade out animation completes, hide splash and show content
        setTimeout(() => {
            splash.style.display = 'none';
            content.style.display = 'block';
            content.style.animation = 'fadeIn 0.5s ease';
            
            // Load conversations from backend
            if (typeof loadConversationsFromBackend === 'function') {
                loadConversationsFromBackend();
            } else {
                // Fallback to mock data if messenger.js not loaded
                loadConversations();
            }
        }, 500);
    }, 2500);
    
    // Mark messages as read
    updateUnreadBadge(0);
}

// Close Messenger
function closeMessenger() {
    const modal = document.getElementById('messengerModal');
    const splash = document.getElementById('messengerSplash');
    const content = document.getElementById('messengerContent');
    
    modal.style.display = 'none';
    currentConversation = null;
    
    // Reset splash screen for next time
    splash.classList.remove('fade-out');
    splash.style.display = 'flex';
    content.style.display = 'none';
}

// Load Conversations from Backend
async function loadConversations() {
    const conversationsList = document.getElementById('conversationsList');
    const token = localStorage.getItem('djangoAuthToken');
    
    if (!token) {
        console.error('No auth token found');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/messenger/conversations/`, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            conversations = await response.json();
            
            conversationsList.innerHTML = conversations.map(conv => {
                const otherUser = conv.other_user;
                if (!otherUser) return '';
                
                return `
                    <div class="conversation-item ${currentConversation?.id === conv.id ? 'active' : ''}" 
                         onclick="openConversation(${conv.id})">
                        <div class="conversation-avatar">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="conversation-info">
                            <div class="conversation-name">
                                <span>${otherUser.username}</span>
                                <span class="conversation-time">${conv.last_message ? formatTime(new Date(conv.last_message.timestamp)) : 'New'}</span>
                            </div>
                            <div class="conversation-preview">${conv.last_message ? conv.last_message.text : 'Start chatting...'}</div>
                        </div>
                        ${conv.unread_count > 0 ? `<span class="conversation-unread">${conv.unread_count}</span>` : ''}
                    </div>
                `;
            }).join('');
            
            // Update unread badge
            const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);
            updateUnreadBadge(totalUnread);
        } else {
            console.error('Failed to load conversations');
            conversationsList.innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">No conversations yet</p>';
        }
    } catch (error) {
        console.error('Error loading conversations:', error);
        conversationsList.innerHTML = '<p style="padding: 20px; text-align: center; color: #666;">Failed to load conversations</p>';
    }
}

// Open Conversation
function openConversation(conversationId) {
    // Use backend if available
    if (typeof openConversationFromBackend === 'function') {
        openConversationFromBackend(conversationId);
        return;
    }
    
    // Fallback to mock implementation
    const conversation = conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    
    currentConversation = conversation;
    
    // Update UI
    document.getElementById('chatEmpty').style.display = 'none';
    document.getElementById('chatActive').style.display = 'flex';
    document.getElementById('chatUsername').textContent = conversation.username;
    document.getElementById('chatStatus').textContent = conversation.online ? 'Online' : 'Offline';
    document.getElementById('chatStatus').className = conversation.online ? 'chat-status' : 'chat-status offline';
    
    // Load messages
    loadMessages(conversationId);
    
    // Update active state
    loadConversations();
    
    // Mobile: show chat panel
    if (window.innerWidth <= 768) {
        document.querySelector('.chat-panel').classList.add('mobile-active');
    }
}

// Load Messages
function loadMessages(conversationId) {
    const messagesContainer = document.getElementById('messagesContainer');
    
    // Mock messages - Replace with actual API call
    if (!messages[conversationId]) {
        messages[conversationId] = [
            {
                id: 1,
                text: 'Hey! How are you doing?',
                sent: false,
                timestamp: new Date(Date.now() - 3600000)
            },
            {
                id: 2,
                text: 'I\'m good! Just finished a tournament.',
                sent: true,
                timestamp: new Date(Date.now() - 3500000)
            },
            {
                id: 3,
                text: 'Nice! How did it go?',
                sent: false,
                timestamp: new Date(Date.now() - 3400000)
            },
            {
                id: 4,
                text: 'Got 2nd place! Pretty happy with that.',
                sent: true,
                timestamp: new Date(Date.now() - 3300000)
            }
        ];
    }
    
    messagesContainer.innerHTML = messages[conversationId].map(msg => `
        <div class="message ${msg.sent ? 'sent' : 'received'}">
            <div class="message-bubble">
                <div class="message-text">${msg.text}</div>
                <div class="message-time">${formatTime(msg.timestamp)}</div>
            </div>
        </div>
    `).join('');
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send Message
function sendMessage() {
    // Use backend if available
    if (typeof sendMessageToBackend === 'function') {
        sendMessageToBackend();
        return;
    }
    
    // Fallback to mock implementation
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text || !currentConversation) return;
    
    // Create new message
    const newMessage = {
        id: Date.now(),
        text: text,
        sent: true,
        timestamp: new Date()
    };
    
    // Add to messages
    if (!messages[currentConversation.id]) {
        messages[currentConversation.id] = [];
    }
    messages[currentConversation.id].push(newMessage);
    
    // Update conversation last message
    const conversation = conversations.find(c => c.id === currentConversation.id);
    if (conversation) {
        conversation.lastMessage = text;
        conversation.timestamp = new Date();
    }
    
    // Clear input
    input.value = '';
    
    // Reload messages and conversations
    loadMessages(currentConversation.id);
    loadConversations();
    
    console.log('Sending message:', text, 'to user:', currentConversation.userId);
}

// Allow Enter key to send message
document.addEventListener('DOMContentLoaded', () => {
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }
});

// Show New Chat Modal
function showNewChatModal() {
    const modal = document.getElementById('newChatModal');
    modal.style.display = 'block';
    
    // Load users from backend if available
    if (typeof loadAvailableUsersFromBackend === 'function') {
        loadAvailableUsersFromBackend();
    } else {
        // Fallback to mock data
        loadAvailableUsers();
    }
}

// Close New Chat Modal
function closeNewChatModal() {
    const modal = document.getElementById('newChatModal');
    modal.style.display = 'none';
}

// Load Available Users
async function loadAvailableUsers() {
    // Try to load from backend first
    if (typeof loadAvailableUsersFromBackend === 'function') {
        await loadAvailableUsersFromBackend();
        return;
    }
    
    // Fallback to mock users if backend not available
    const usersList = document.getElementById('usersList');
    
    // Mock users - Replace with actual API call
    const users = [
        { id: 5, username: 'MasterChief', tier: 'Diamond', online: true },
        { id: 6, username: 'ShadowNinja', tier: 'Gold', online: false },
        { id: 7, username: 'ThunderBolt', tier: 'Platinum', online: true },
        { id: 8, username: 'PhoenixRise', tier: 'Silver', online: true },
        { id: 9, username: 'IceQueen', tier: 'Gold', online: false }
    ];
    
    usersList.innerHTML = users.map(user => `
        <div class="user-item" onclick="startNewConversation(${user.id}, '${user.username}', '${user.tier}')">
            <div class="user-avatar">
                <i class="fas fa-user"></i>
            </div>
            <div class="user-details">
                <div class="user-name">${user.username}</div>
                <div class="user-tier">${user.tier} Tier</div>
            </div>
            ${user.online ? '<span style="color: #4caf50;"><i class="fas fa-circle"></i></span>' : ''}
        </div>
    `).join('');
}

// Start New Conversation
function startNewConversation(userId, username, tier) {
    // Use backend if available
    if (typeof startNewConversationWithUser === 'function') {
        startNewConversationWithUser(userId);
        return;
    }
    
    // Fallback to mock implementation
    // Check if conversation already exists
    let conversation = conversations.find(c => c.userId === userId);
    
    if (!conversation) {
        // Create new conversation
        conversation = {
            id: Date.now(),
            userId: userId,
            username: username,
            tier: tier,
            lastMessage: 'Start chatting...',
            timestamp: new Date(),
            unread: 0,
            online: true
        };
        conversations.unshift(conversation);
    }
    
    // Close new chat modal
    closeNewChatModal();
    
    // Open the conversation
    openConversation(conversation.id);
}

// Update Unread Badge
function updateUnreadBadge(count) {
    const badge = document.getElementById('unreadBadge');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// Format Time
function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) {
        return 'Just now';
    }
    
    // Less than 1 hour
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}h ago`;
    }
    
    // Less than 7 days
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}d ago`;
    }
    
    // Format as date
    return date.toLocaleDateString();
}

// Search Users in Conversations
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchUsers');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.conversation-item');
            
            items.forEach(item => {
                const username = item.querySelector('.conversation-name span').textContent.toLowerCase();
                if (username.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
    
    // Search in new chat modal
    const newChatSearch = document.getElementById('newChatSearch');
    if (newChatSearch) {
        newChatSearch.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const items = document.querySelectorAll('.user-item');
            
            items.forEach(item => {
                const username = item.querySelector('.user-name').textContent.toLowerCase();
                if (username.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
});

// Simulate receiving messages (for demo purposes)
function simulateIncomingMessage() {
    if (conversations.length > 0) {
        const randomConv = conversations[Math.floor(Math.random() * conversations.length)];
        const newMessage = {
            id: Date.now(),
            text: 'This is a simulated incoming message!',
            sent: false,
            timestamp: new Date()
        };
        
        if (!messages[randomConv.id]) {
            messages[randomConv.id] = [];
        }
        messages[randomConv.id].push(newMessage);
        
        randomConv.lastMessage = newMessage.text;
        randomConv.timestamp = new Date();
        randomConv.unread = (randomConv.unread || 0) + 1;
        
        // Update UI if messenger is open
        if (document.getElementById('messengerModal').style.display === 'block') {
            loadConversations();
            if (currentConversation?.id === randomConv.id) {
                loadMessages(randomConv.id);
            }
        }
        
        // Update unread badge
        const totalUnread = conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
        updateUnreadBadge(totalUnread);
    }
}

// Simulate incoming messages every 30 seconds (for demo)
setInterval(simulateIncomingMessage, 30000);


// Load wallet balance and display in header
async function loadWalletBalance() {
    const token = localStorage.getItem('djangoAuthToken');
    
    if (!token) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/payments/wallet/`, {
            headers: {
                'Authorization': `Token ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            const wallet = data.wallet;
            
            // Update wallet balance in header
            const walletBalanceEl = document.getElementById('walletBalance');
            const walletBadgeEl = document.getElementById('walletBalanceBadge');
            
            if (walletBalanceEl && wallet) {
                const balance = parseFloat(wallet.available_balance).toFixed(2);
                walletBalanceEl.textContent = `K${balance}`;
                
                // Show wallet badge
                if (walletBadgeEl) {
                    walletBadgeEl.style.display = 'flex';
                }
            }
        }
    } catch (error) {
        console.error('Failed to load wallet balance:', error);
    }
}


// ============================================
// DAILY STREAK TRACKING SYSTEM
// ============================================

/**
 * Streak Tracking System
 * Tracks consecutive days of user activity from account creation
 */

// Initialize streak tracking
function initializeStreakTracking() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    if (!user.id) {
        console.log('No user logged in, skipping streak tracking');
        return;
    }
    
    // Check and update streak
    updateDailyStreak();
    
    // Update streak display
    displayStreak();
}

// Update daily streak
function updateDailyStreak() {
    const today = new Date().toDateString();
    const streakData = getStreakData();
    
    // If already checked in today, don't update
    if (streakData.lastCheckIn === today) {
        console.log('Already checked in today');
        return streakData;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    
    // Check if user checked in yesterday
    if (streakData.lastCheckIn === yesterdayStr) {
        // Continue streak
        streakData.currentStreak += 1;
    } else if (streakData.lastCheckIn && streakData.lastCheckIn !== today) {
        // Streak broken - reset to 1
        streakData.currentStreak = 1;
        streakData.streakBroken = true;
    } else {
        // First check-in or same day
        streakData.currentStreak = 1;
    }
    
    // Update last check-in
    streakData.lastCheckIn = today;
    
    // Update longest streak
    if (streakData.currentStreak > streakData.longestStreak) {
        streakData.longestStreak = streakData.currentStreak;
    }
    
    // Increment total days active
    streakData.totalDaysActive += 1;
    
    // Save streak data
    saveStreakData(streakData);
    
    // Show notification if streak milestone reached
    checkStreakMilestones(streakData.currentStreak);
    
    return streakData;
}

// Get streak data from localStorage
function getStreakData() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const defaultData = {
        userId: user.id,
        accountCreated: user.date_joined || new Date().toISOString(),
        currentStreak: 0,
        longestStreak: 0,
        lastCheckIn: null,
        totalDaysActive: 0,
        streakBroken: false,
        milestones: []
    };
    
    const saved = localStorage.getItem(`streak_${user.id}`);
    return saved ? JSON.parse(saved) : defaultData;
}

// Save streak data to localStorage
function saveStreakData(data) {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    localStorage.setItem(`streak_${user.id}`, JSON.stringify(data));
}

// Display streak in UI
function displayStreak() {
    const streakData = getStreakData();
    
    // Update all streak displays
    const streakElements = [
        'userMenuStreak',
        'dashStreak',
        'sidebarStreak'
    ];
    
    streakElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = streakData.currentStreak;
            
            // Add fire animation if streak is active
            if (streakData.currentStreak > 0) {
                element.classList.add('streak-active');
            }
        }
    });
    
    // Update longest streak if element exists
    const longestStreakEl = document.getElementById('longestStreak');
    if (longestStreakEl) {
        longestStreakEl.textContent = streakData.longestStreak;
    }
    
    // Calculate days since account creation
    const accountAge = calculateAccountAge(streakData.accountCreated);
    const accountAgeEl = document.getElementById('accountAge');
    if (accountAgeEl) {
        accountAgeEl.textContent = `${accountAge} days`;
    }
    
    // Show streak broken message if applicable
    if (streakData.streakBroken) {
        showStreakBrokenNotification();
        streakData.streakBroken = false;
        saveStreakData(streakData);
    }
}

// Calculate days since account creation
function calculateAccountAge(createdDate) {
    const created = new Date(createdDate);
    const today = new Date();
    const diffTime = Math.abs(today - created);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
}

// Check for streak milestones
function checkStreakMilestones(streak) {
    const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
    const streakData = getStreakData();
    
    milestones.forEach(milestone => {
        if (streak === milestone && !streakData.milestones.includes(milestone)) {
            // New milestone reached!
            streakData.milestones.push(milestone);
            saveStreakData(streakData);
            showStreakMilestoneNotification(milestone);
            
            // Award bonus prestige
            awardStreakBonus(milestone);
        }
    });
}

// Show streak milestone notification
function showStreakMilestoneNotification(days) {
    const messages = {
        3: '🔥 3-Day Streak! You\'re on fire!',
        7: '🔥 Week Streak! Amazing dedication!',
        14: '🔥 2-Week Streak! You\'re unstoppable!',
        30: '🔥 30-Day Streak! Legendary commitment!',
        60: '🔥 60-Day Streak! You\'re a champion!',
        90: '🔥 90-Day Streak! Incredible dedication!',
        180: '🔥 180-Day Streak! Half a year strong!',
        365: '🔥 365-Day Streak! ONE YEAR! You\'re a legend!'
    };
    
    const message = messages[days] || `🔥 ${days}-Day Streak!`;
    
    showStreakNotification(message, 'milestone');
}

// Show streak broken notification
function showStreakBrokenNotification() {
    showStreakNotification('💔 Your streak was broken. Start a new one today!', 'broken');
}

// Show streak notification
function showStreakNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `streak-notification streak-${type}`;
    notification.innerHTML = `
        <div class="streak-notification-content">
            <div class="streak-icon">
                ${type === 'milestone' ? '🔥' : type === 'broken' ? '💔' : '✨'}
            </div>
            <div class="streak-message">${message}</div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

// Award streak bonus prestige
function awardStreakBonus(days) {
    const bonuses = {
        3: 10,
        7: 25,
        14: 50,
        30: 100,
        60: 250,
        90: 500,
        180: 1000,
        365: 5000
    };
    
    const bonus = bonuses[days] || 0;
    
    if (bonus > 0) {
        // Add prestige points
        const currentPrestige = parseInt(localStorage.getItem('userPrestige') || '0');
        const newPrestige = currentPrestige + bonus;
        localStorage.setItem('userPrestige', newPrestige);
        
        // Update display
        updatePrestigeDisplay(newPrestige);
        
        console.log(`Awarded ${bonus} prestige for ${days}-day streak!`);
    }
}

// Get streak statistics
function getStreakStats() {
    const streakData = getStreakData();
    const accountAge = calculateAccountAge(streakData.accountCreated);
    
    return {
        currentStreak: streakData.currentStreak,
        longestStreak: streakData.longestStreak,
        totalDaysActive: streakData.totalDaysActive,
        accountAge: accountAge,
        activityRate: ((streakData.totalDaysActive / accountAge) * 100).toFixed(1),
        milestones: streakData.milestones
    };
}

// Reset streak (for testing or admin purposes)
function resetStreak() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (confirm('Are you sure you want to reset your streak? This cannot be undone!')) {
        localStorage.removeItem(`streak_${user.id}`);
        initializeStreakTracking();
        showStreakNotification('Streak has been reset', 'info');
    }
}

// Export streak data
function exportStreakData() {
    const stats = getStreakStats();
    const data = {
        ...stats,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streak-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// Initialize streak tracking when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for user data to load
    setTimeout(() => {
        initializeStreakTracking();
    }, 1000);
});

// Update streak every time user performs an action
function recordUserActivity() {
    updateDailyStreak();
}

// Expose functions globally
window.streakSystem = {
    initialize: initializeStreakTracking,
    update: updateDailyStreak,
    display: displayStreak,
    getStats: getStreakStats,
    reset: resetStreak,
    export: exportStreakData,
    recordActivity: recordUserActivity
};


// Update streak stats display with detailed information
function updateStreakStatsDisplay() {
    const stats = getStreakStats();
    
    // Update stat values
    document.getElementById('currentStreakStat').textContent = stats.currentStreak;
    document.getElementById('longestStreak').textContent = stats.longestStreak;
    document.getElementById('totalDaysActive').textContent = stats.totalDaysActive;
    document.getElementById('accountAge').textContent = stats.accountAge;
    
    // Calculate progress to next milestone
    const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
    const nextMilestone = milestones.find(m => m > stats.currentStreak) || 365;
    const prevMilestone = milestones.filter(m => m <= stats.currentStreak).pop() || 0;
    const progress = ((stats.currentStreak - prevMilestone) / (nextMilestone - prevMilestone)) * 100;
    
    document.getElementById('streakProgressFill').style.width = `${progress}%`;
    document.getElementById('nextStreakMilestone').textContent = `${nextMilestone} days`;
    
    // Update milestone badges
    stats.milestones.forEach(milestone => {
        const badge = document.querySelector(`[data-milestone="${milestone}"]`);
        if (badge) {
            badge.classList.remove('locked');
            badge.innerHTML = `<i class="fas fa-check"></i> ${milestone} Days`;
        }
    });
}

// Call this function after initializing streak
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof updateStreakStatsDisplay === 'function') {
            updateStreakStatsDisplay();
        }
    }, 1500);
});
