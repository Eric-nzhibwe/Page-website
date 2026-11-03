// Influencers Page Logic

// Mobile Menu Toggle
function toggleMobileMenu() {
    const nav = document.getElementById('mainNav');
    if (nav) {
        nav.classList.toggle('active');
    }
}

let currentUserId = null;
let player = null;
let influencers = [];
let weeklyEvents = [];
let specialChallenges = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (!checkAuth()) {
        window.location.href = 'auth.html';
        return;
    }
    
    loadPlayerData();
    initializeInfluencers();
    initializeWeeklyEvents();
    initializeSpecialChallenges();
    renderInfluencers();
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
        
        // Initialize following list
        if (!player.following) {
            player.following = [];
        }
        
        // Initialize virtual currency
        if (player.virtualCurrency === undefined) {
            player.virtualCurrency = 0;
        }
        
        savePlayerData();
        updateUI();
    }
}

function savePlayerData() {
    if (!currentUserId) return;
    localStorage.setItem(`artPlayer_${currentUserId}`, JSON.stringify(player));
    
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
}

function logout() {
    if (confirm('Logout?')) {
        localStorage.removeItem('artCurrentUser');
        window.location.href = 'auth.html';
    }
}

// Initialize Influencers
function initializeInfluencers() {
    const saved = localStorage.getItem('artInfluencers');
    if (saved) {
        influencers = JSON.parse(saved);
    } else {
        influencers = [
            {
                id: 'inf1',
                name: 'ArtMaster Pro',
                handle: '@artmasterpro',
                bio: 'Professional artist and content creator. Specializing in abstract interpretations and creative challenges.',
                followers: 125000,
                challenges: 45,
                avgReward: 150,
                verified: true,
                category: 'Art'
            },
            {
                id: 'inf2',
                name: 'Creative Genius',
                handle: '@creativegenius',
                bio: 'Pushing boundaries of creativity. Join my weekly challenges for exclusive rewards!',
                followers: 89000,
                challenges: 32,
                avgReward: 120,
                verified: true,
                category: 'Design'
            },
            {
                id: 'inf3',
                name: 'Speed Challenger',
                handle: '@speedchallenger',
                bio: 'Fast-paced challenges for quick thinkers. Can you beat the clock?',
                followers: 67000,
                challenges: 28,
                avgReward: 100,
                verified: true,
                category: 'Speed'
            },
            {
                id: 'inf4',
                name: 'Elite Curator',
                handle: '@elitecurator',
                bio: 'Curating the finest interpretations. High-tier challenges for serious competitors.',
                followers: 156000,
                challenges: 52,
                avgReward: 200,
                verified: true,
                category: 'Elite'
            },
            {
                id: 'inf5',
                name: 'Daily Inspiration',
                handle: '@dailyinspiration',
                bio: 'New challenge every day! Perfect for building your streak and earning rewards.',
                followers: 98000,
                challenges: 120,
                avgReward: 80,
                verified: true,
                category: 'Daily'
            },
            {
                id: 'inf6',
                name: 'Theme Master',
                handle: '@thememaster',
                bio: 'Themed challenges that tell a story. Join the narrative!',
                followers: 73000,
                challenges: 38,
                avgReward: 110,
                verified: true,
                category: 'Themed'
            }
        ];
        localStorage.setItem('artInfluencers', JSON.stringify(influencers));
    }
}

// Initialize Weekly Events
function initializeWeeklyEvents() {
    const saved = localStorage.getItem('artWeeklyEvents');
    if (saved) {
        weeklyEvents = JSON.parse(saved);
    } else {
        const now = new Date();
        weeklyEvents = [
            {
                id: 'evt1',
                title: 'Abstract Expressions Week',
                host: 'ArtMaster Pro',
                hostId: 'inf1',
                description: 'Explore abstract art through unique interpretations. Best submissions win exclusive rewards!',
                startDate: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString(),
                prize: 500,
                participants: 234,
                status: 'upcoming'
            },
            {
                id: 'evt2',
                title: 'Speed Challenge Marathon',
                host: 'Speed Challenger',
                hostId: 'inf3',
                description: '5-minute challenges all week long. Quick thinking, big rewards!',
                startDate: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
                prize: 300,
                participants: 567,
                status: 'active'
            },
            {
                id: 'evt3',
                title: 'Elite Masters Tournament',
                host: 'Elite Curator',
                hostId: 'inf4',
                description: 'Only for Platinum tier and above. Compete for the grand prize!',
                startDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000).toISOString(),
                prize: 1000,
                participants: 89,
                status: 'upcoming',
                tierRequired: 'Platinum'
            },
            {
                id: 'evt4',
                title: 'Daily Streak Challenge',
                host: 'Daily Inspiration',
                hostId: 'inf5',
                description: 'Complete a challenge every day this week for bonus rewards!',
                startDate: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(),
                prize: 250,
                participants: 892,
                status: 'active'
            }
        ];
        localStorage.setItem('artWeeklyEvents', JSON.stringify(weeklyEvents));
    }
}

// Initialize Special Challenges
function initializeSpecialChallenges() {
    const saved = localStorage.getItem('artSpecialChallenges');
    if (saved) {
        specialChallenges = JSON.parse(saved);
    } else {
        specialChallenges = [
            {
                id: 'sc1',
                type: 'daily',
                title: 'Daily Open Challenge',
                description: 'Open to all players. New challenge every 24 hours with fresh rewards!',
                difficulty: 'medium',
                timeLimit: 30,
                reward: 50,
                imageUrl: 'https://via.placeholder.com/400x300/f5576c/ffffff?text=Daily+Challenge',
                participants: 456,
                endsIn: '18h 32m'
            },
            {
                id: 'sc2',
                type: 'weekly',
                title: 'Weekly Elite Challenge',
                description: 'Premium challenge with higher difficulty and bigger rewards. Resets every Monday!',
                difficulty: 'hard',
                timeLimit: 60,
                reward: 150,
                imageUrl: 'https://via.placeholder.com/400x300/2196f3/ffffff?text=Weekly+Elite',
                participants: 234,
                endsIn: '4d 12h'
            },
            {
                id: 'sc3',
                type: 'speed',
                title: 'Speed Blitz',
                description: 'Think fast! Only 5 minutes to complete. Quick rewards for quick thinkers!',
                difficulty: 'easy',
                timeLimit: 5,
                reward: 30,
                imageUrl: 'https://via.placeholder.com/400x300/ff9800/ffffff?text=Speed+Blitz',
                participants: 789,
                endsIn: '2h 15m'
            },
            {
                id: 'sc4',
                type: 'tier',
                title: 'Gold Tier Exclusive',
                description: 'Restricted to Gold tier and above. Prove your elite status!',
                difficulty: 'expert',
                timeLimit: 90,
                reward: 250,
                tierRequired: 'Gold',
                imageUrl: 'https://via.placeholder.com/400x300/9c27b0/ffffff?text=Tier+Exclusive',
                participants: 123,
                endsIn: '6d 8h'
            },
            {
                id: 'sc5',
                type: 'daily',
                title: 'Morning Inspiration',
                description: 'Start your day with creativity. Fresh challenge every morning!',
                difficulty: 'easy',
                timeLimit: 20,
                reward: 40,
                imageUrl: 'https://via.placeholder.com/400x300/4caf50/ffffff?text=Morning+Challenge',
                participants: 567,
                endsIn: '12h 45m'
            },
            {
                id: 'sc6',
                type: 'speed',
                title: 'Lightning Round',
                description: 'Ultra-fast 3-minute challenge. Maximum intensity, maximum fun!',
                difficulty: 'medium',
                timeLimit: 3,
                reward: 25,
                imageUrl: 'https://via.placeholder.com/400x300/ff5722/ffffff?text=Lightning+Round',
                participants: 923,
                endsIn: '45m'
            }
        ];
        localStorage.setItem('artSpecialChallenges', JSON.stringify(specialChallenges));
    }
}

// Tab Switching
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(tabName).classList.add('active');
    
    if (tabName === 'influencers') renderInfluencers();
    if (tabName === 'events') renderWeeklyEvents();
    if (tabName === 'special') renderSpecialChallenges();
}

// Render Influencers
function renderInfluencers() {
    const container = document.getElementById('influencersGrid');
    
    container.innerHTML = influencers.map(influencer => {
        const isFollowing = player.following.includes(influencer.id);
        
        return `
            <div class="influencer-card">
                <div class="influencer-banner">
                    ${influencer.verified ? '<div class="verified-badge"><i class="fas fa-check-circle"></i> Verified</div>' : ''}
                    <div class="influencer-avatar">${influencer.name.charAt(0)}</div>
                </div>
                <div class="influencer-body">
                    <h3 class="influencer-name">${influencer.name}</h3>
                    <p class="influencer-handle">${influencer.handle}</p>
                    <p class="influencer-bio">${influencer.bio}</p>
                    
                    <div class="influencer-stats">
                        <div class="stat-item">
                            <span class="stat-value">${formatNumber(influencer.followers)}</span>
                            <span class="stat-label">Followers</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${influencer.challenges}</span>
                            <span class="stat-label">Challenges</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-value">${influencer.avgReward}</span>
                            <span class="stat-label">Avg Reward</span>
                        </div>
                    </div>
                    
                    <div class="influencer-footer">
                        <button class="btn-follow ${isFollowing ? 'following' : ''}" onclick="toggleFollow(event, '${influencer.id}')">
                            ${isFollowing ? '<i class="fas fa-check"></i> Following' : '<i class="fas fa-plus"></i> Follow'}
                        </button>
                        <button class="btn-view" onclick="viewInfluencer('${influencer.id}')">
                            <i class="fas fa-eye"></i> View
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Toggle Follow
function toggleFollow(event, influencerId) {
    event.stopPropagation();
    
    const index = player.following.indexOf(influencerId);
    if (index > -1) {
        player.following.splice(index, 1);
    } else {
        player.following.push(influencerId);
        // Reward for following
        player.virtualCurrency += 5;
    }
    
    savePlayerData();
    updateUI();
    renderInfluencers();
}

// View Influencer
function viewInfluencer(influencerId) {
    const influencer = influencers.find(i => i.id === influencerId);
    if (!influencer) return;
    
    const isFollowing = player.following.includes(influencerId);
    const influencerEvents = weeklyEvents.filter(e => e.hostId === influencerId);
    
    document.getElementById('influencerDetail').innerHTML = `
        <div style="text-align: center; margin-bottom: 30px;">
            <div style="width: 120px; height: 120px; margin: 0 auto 20px; border-radius: 50%; background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%); display: flex; align-items: center; justify-content: center; font-size: 48px; font-weight: bold; color: #000;">
                ${influencer.name.charAt(0)}
            </div>
            <h2>${influencer.name}</h2>
            <p style="color: #888; margin: 10px 0;">${influencer.handle}</p>
            ${influencer.verified ? '<span style="background: #4caf50; color: #fff; padding: 5px 12px; border-radius: 20px; font-size: 12px;"><i class="fas fa-check-circle"></i> Verified</span>' : ''}
        </div>
        
        <p style="color: #aaa; text-align: center; line-height: 1.8; margin-bottom: 30px;">${influencer.bio}</p>
        
        <div style="display: flex; justify-content: space-around; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 30px;">
            <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${formatNumber(influencer.followers)}</div>
                <div style="color: #888; font-size: 14px;">Followers</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${influencer.challenges}</div>
                <div style="color: #888; font-size: 14px;">Challenges</div>
            </div>
            <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${influencer.avgReward}</div>
                <div style="color: #888; font-size: 14px;">Avg Reward</div>
            </div>
        </div>
        
        <h3 style="margin-bottom: 20px;"><i class="fas fa-calendar"></i> Upcoming Events</h3>
        ${influencerEvents.length > 0 ? influencerEvents.map(event => `
            <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; margin-bottom: 15px;">
                <h4 style="color: #f5576c; margin-bottom: 10px;">${event.title}</h4>
                <p style="color: #aaa; font-size: 14px;">${event.description}</p>
                <div style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: #888;"><i class="fas fa-users"></i> ${event.participants} participants</span>
                    <span style="background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%); color: #000; padding: 5px 12px; border-radius: 20px; font-weight: bold;">
                        <i class="fas fa-coins"></i> ${event.prize}
                    </span>
                </div>
            </div>
        `).join('') : '<p style="color: #888; text-align: center; padding: 20px;">No upcoming events</p>'}
        
        <button class="btn-follow ${isFollowing ? 'following' : ''}" style="width: 100%; padding: 15px; font-size: 18px; margin-top: 20px;" onclick="toggleFollowFromModal('${influencer.id}')">
            ${isFollowing ? '<i class="fas fa-check"></i> Following' : '<i class="fas fa-plus"></i> Follow'}
        </button>
    `;
    
    document.getElementById('influencerModal').style.display = 'block';
}

function toggleFollowFromModal(influencerId) {
    toggleFollow(event, influencerId);
    viewInfluencer(influencerId);
}

function closeInfluencerModal() {
    document.getElementById('influencerModal').style.display = 'none';
}

// Render Weekly Events
function renderWeeklyEvents() {
    const container = document.getElementById('eventsGrid');
    
    container.innerHTML = weeklyEvents.map(event => {
        const daysUntil = Math.ceil((new Date(event.startDate) - new Date()) / (1000 * 60 * 60 * 24));
        const statusBadge = event.status === 'active' ? 
            '<span style="background: #4caf50; color: #fff; padding: 5px 12px; border-radius: 20px; font-size: 12px;">LIVE NOW</span>' :
            `<span style="background: #ff9800; color: #fff; padding: 5px 12px; border-radius: 20px; font-size: 12px;">STARTS IN ${daysUntil}D</span>`;
        
        return `
            <div class="event-card" onclick="viewEvent('${event.id}')">
                <div class="event-icon">
                    <i class="fas fa-trophy"></i>
                </div>
                <div class="event-info">
                    <h3>${event.title}</h3>
                    <p class="event-host">Hosted by ${event.host}</p>
                    <p class="event-description">${event.description}</p>
                    <div class="event-meta">
                        <span class="meta-item">
                            <i class="fas fa-users"></i> ${event.participants} participants
                        </span>
                        <span class="meta-item">
                            <i class="fas fa-calendar"></i> ${new Date(event.startDate).toLocaleDateString()}
                        </span>
                        ${event.tierRequired ? `<span class="meta-item"><i class="fas fa-crown"></i> ${event.tierRequired}+ only</span>` : ''}
                        ${statusBadge}
                    </div>
                </div>
                <div class="event-actions">
                    <div class="event-prize">
                        <i class="fas fa-coins"></i> ${event.prize} coins
                    </div>
                    <button class="btn-join" onclick="joinEvent(event, '${event.id}')">
                        ${event.status === 'active' ? 'Join Now' : 'Register'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// View Event
function viewEvent(eventId) {
    const event = weeklyEvents.find(e => e.id === eventId);
    if (!event) return;
    
    document.getElementById('eventDetail').innerHTML = `
        <h2>${event.title}</h2>
        <p style="color: #888; margin: 10px 0;">Hosted by ${event.host}</p>
        
        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; margin: 20px 0;">
            <p style="color: #aaa; line-height: 1.8;">${event.description}</p>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 30px 0;">
            <div style="text-align: center; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${event.prize}</div>
                <div style="color: #888; font-size: 14px;">Prize Pool</div>
            </div>
            <div style="text-align: center; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${event.participants}</div>
                <div style="color: #888; font-size: 14px;">Participants</div>
            </div>
            <div style="text-align: center; padding: 20px; background: rgba(255,255,255,0.05); border-radius: 12px;">
                <div style="font-size: 32px; font-weight: bold; color: #f5576c;">${Math.ceil((new Date(event.endDate) - new Date()) / (1000 * 60 * 60 * 24))}</div>
                <div style="color: #888; font-size: 14px;">Days Left</div>
            </div>
        </div>
        
        <button class="btn-join" style="width: 100%; padding: 15px; font-size: 18px;" onclick="joinEventFromModal('${event.id}')">
            ${event.status === 'active' ? '<i class="fas fa-play"></i> Join Now' : '<i class="fas fa-bell"></i> Register'}
        </button>
    `;
    
    document.getElementById('eventModal').style.display = 'block';
}

function joinEvent(e, eventId) {
    e.stopPropagation();
    alert('Event registration successful! You\'ll be notified when it starts.');
}

function joinEventFromModal(eventId) {
    alert('Event registration successful! You\'ll be notified when it starts.');
    closeEventModal();
}

function closeEventModal() {
    document.getElementById('eventModal').style.display = 'none';
}

// Render Special Challenges
function renderSpecialChallenges() {
    const container = document.getElementById('specialChallengesGrid');
    
    container.innerHTML = specialChallenges.map(challenge => {
        const typeClass = `type-${challenge.type}`;
        const typeName = challenge.type.charAt(0).toUpperCase() + challenge.type.slice(1);
        
        return `
            <div class="special-challenge-card" onclick="window.location.href='challenges.html'">
                <div style="position: relative;">
                    <div class="challenge-type-badge ${typeClass}">${typeName}</div>
                    <div class="challenge-image" style="background: linear-gradient(135deg, #f5576c 0%, #f093fb 100%); display: flex; align-items: center; justify-content: center; font-size: 48px;">
                        <i class="fas fa-${challenge.type === 'daily' ? 'calendar-day' : challenge.type === 'weekly' ? 'calendar-week' : challenge.type === 'speed' ? 'bolt' : 'crown'}"></i>
                    </div>
                </div>
                <div class="challenge-body">
                    <h3 class="challenge-title">${challenge.title}</h3>
                    <p class="challenge-description">${challenge.description}</p>
                    <div class="challenge-meta">
                        <span><i class="fas fa-clock"></i> ${challenge.timeLimit} min</span>
                        <span><i class="fas fa-users"></i> ${challenge.participants}</span>
                    </div>
                </div>
                <div class="challenge-footer">
                    <span class="reward-badge"><i class="fas fa-coins"></i> ${challenge.reward}</span>
                    <button class="btn-participate">Participate</button>
                </div>
            </div>
        `;
    }).join('');
}

// Utility Functions
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

// Make functions global
window.toggleMobileMenu = toggleMobileMenu;
window.logout = logout;
window.switchTab = switchTab;
window.toggleFollow = toggleFollow;
window.viewInfluencer = viewInfluencer;
window.toggleFollowFromModal = toggleFollowFromModal;
window.closeInfluencerModal = closeInfluencerModal;
window.viewEvent = viewEvent;
window.joinEvent = joinEvent;
window.joinEventFromModal = joinEventFromModal;
window.closeEventModal = closeEventModal;
