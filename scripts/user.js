// ARTX - Profile Page Script

const PROFILE_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let profileData = null;

const TIER_MILESTONES = [
    { min: 5000, name: 'Legendary' },
    { min: 2500, name: 'Elite' },
    { min: 1500, name: 'Diamond' },
    { min: 1000, name: 'Platinum' },
    { min: 500,  name: 'Gold' },
    { min: 200,  name: 'Silver' },
    { min: 0,    name: 'Bronze' },
];

const ACTIVITY_ICONS = {
    prestige_gained:    { icon: 'fa-star',        color: '#ffd700' },
    level_up:           { icon: 'fa-arrow-up',    color: '#4caf50' },
    tier_upgrade:       { icon: 'fa-crown',       color: '#ff9800' },
    tournament_entry:   { icon: 'fa-trophy',      color: '#2196f3' },
    tournament_win:     { icon: 'fa-medal',       color: '#ffd700' },
    alliance_join:      { icon: 'fa-users',       color: '#9c27b0' },
    alliance_create:    { icon: 'fa-flag',        color: '#9c27b0' },
    payment_made:       { icon: 'fa-credit-card', color: '#22c1c3' },
    submission_success: { icon: 'fa-check',       color: '#4caf50' },
    submission_failed:  { icon: 'fa-times',       color: '#f44336' },
};

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) {
        window.location.href = '/pages/auth.html';
        return;
    }
    await loadProfile();
    await loadActivities();
});

async function loadProfile() {
    const token = localStorage.getItem('djangoAuthToken');
    try {
        const res = await fetch(`${PROFILE_API}/auth/stats/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        profileData = data.user;
        renderProfile(profileData, data.rank);
    } catch (e) {
        console.error('Profile load error:', e);
    }
}

function renderProfile(u, rank) {
    // Hero
    document.getElementById('profileDisplayName').textContent = u.display_name || u.username;
    document.getElementById('profileUsername').textContent = `@${u.username}`;
    document.getElementById('profileTier').textContent = u.access_tier;
    document.getElementById('profileRank').textContent = u.power_rank;
    if (u.is_verified) document.getElementById('profileVerified').style.display = 'inline-flex';

    // Hero bio (shown directly under name)
    const heroBio = document.getElementById('heroBio');
    if (heroBio) heroBio.textContent = u.bio || '—';

    // Avatar level badge
    const lvlBadge = document.getElementById('avatarLevel');
    if (lvlBadge) lvlBadge.textContent = u.level;

    // Avatar
    if (u.profile_image) {
        document.getElementById('avatarDisplay').innerHTML = `<img src="${u.profile_image}" alt="avatar">`;
    }

    // Stats ribbon
    document.getElementById('statPrestige').textContent = u.prestige_points.toLocaleString();
    document.getElementById('statLevel').textContent = u.level;
    document.getElementById('statStreak').textContent = u.current_streak;
    document.getElementById('statWins').textContent = u.tournament_wins;
    document.getElementById('statSuccessRate').textContent = `${u.success_rate}%`;
    document.getElementById('statEarnings').textContent = `K${parseFloat(u.total_earnings).toFixed(0)}`;

    // About
    document.getElementById('profileBio').textContent = u.bio || 'No bio yet.';
    document.getElementById('profileEmail').textContent = u.email;
    document.getElementById('profileJoined').textContent = new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    document.getElementById('profileVerLevel').textContent = u.verification_level;

    // Prestige progress
    const pts = u.prestige_points;
    const milestones = [0, 200, 500, 1000, 1500, 2500, 5000, 10000];
    const next = milestones.find(m => m > pts) || milestones[milestones.length - 1];
    const prev = [...milestones].reverse().find(m => m <= pts) || 0;
    const pct = prev === next ? 100 : ((pts - prev) / (next - prev)) * 100;
    document.getElementById('prestigePoints').textContent = pts.toLocaleString();
    document.getElementById('prestigeNext').textContent = next.toLocaleString();
    // Animate bar after short delay for visual effect
    setTimeout(() => {
        document.getElementById('prestigeBar').style.width = `${Math.min(pct, 100)}%`;
    }, 300);

    // Tier ladder highlight (abbreviated labels in ladder)
    const tierMap = { 'Bronze': 'Bronze', 'Silver': 'Silver', 'Gold': 'Gold', 'Platinum': 'Plat', 'Diamond': 'Diam', 'Elite': 'Elite', 'Legendary': 'Legend' };
    const activeLadderText = tierMap[u.access_tier] || u.access_tier;
    document.querySelectorAll('.tier-step').forEach(el => {
        el.classList.toggle('active', el.textContent.trim() === activeLadderText || el.textContent.trim() === u.access_tier);
    });

    // Performance
    const wrong = u.total_submissions - u.successful_submissions;
    document.getElementById('perfSubmissions').textContent = u.total_submissions;
    document.getElementById('perfCorrect').textContent = u.successful_submissions;
    document.getElementById('perfWrong').textContent = wrong;
    document.getElementById('perfWins').textContent = u.tournament_wins;
    document.getElementById('successRateLabel').textContent = `${u.success_rate}%`;
    document.getElementById('accuracyPctDisplay') && (document.getElementById('accuracyPctDisplay').textContent = `${u.success_rate}%`);
    setTimeout(() => {
        document.getElementById('successBar').style.width = `${u.success_rate}%`;
    }, 500);

    // User menu dropdown info
    const menuUsername = document.getElementById('menuUsername');
    const menuTier     = document.getElementById('menuTier');
    const menuPrestige = document.getElementById('menuPrestige');
    const menuStreak   = document.getElementById('menuStreak');
    if (menuUsername) menuUsername.textContent = u.display_name || u.username;
    if (menuTier)     menuTier.textContent = `${u.access_tier} Tier`;
    if (menuPrestige) menuPrestige.textContent = u.prestige_points.toLocaleString();
    if (menuStreak)   menuStreak.textContent = u.current_streak;

    // Social connections
    renderSocial(u.social_connections || {});
}

function renderSocial(connections) {
    const list = document.getElementById('socialList');
    const platforms = Object.entries(connections).filter(([, v]) => v.connected);

    if (platforms.length === 0) {
        list.innerHTML = '<p class="empty-state">No social accounts connected.</p>';
        return;
    }

    const icons = { twitter: 'fa-twitter', instagram: 'fa-instagram', youtube: 'fa-youtube', tiktok: 'fa-tiktok', facebook: 'fa-facebook' };

    list.innerHTML = platforms.map(([platform, data]) => `
        <div class="social-item">
            <i class="fab ${icons[platform] || 'fa-link'}"></i>
            <span class="social-name">${platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
            <span class="social-handle">@${data.username}</span>
            ${data.verified ? '<i class="fas fa-check-circle verified-dot"></i>' : ''}
        </div>
    `).join('');
}

async function loadActivities() {
    const token = localStorage.getItem('djangoAuthToken');
    const list = document.getElementById('activityList');
    try {
        const res = await fetch(`${PROFILE_API}/auth/activities/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const activities = data.results || data;

        if (!activities.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><span>No activity yet.</span></div>';
            return;
        }

        const actCount = document.getElementById('activityCount');
        if (actCount) actCount.textContent = activities.length > 15 ? '15+' : activities.length;

        list.innerHTML = activities.slice(0, 15).map(a => {
            const meta = ACTIVITY_ICONS[a.activity_type] || { icon: 'fa-circle', color: '#aaa' };
            return `
                <div class="activity-entry">
                    <div class="activity-icon" style="background: ${meta.color}">
                        <i class="fas ${meta.icon}"></i>
                    </div>
                    <div class="activity-body">
                        <div class="activity-desc">${a.description}</div>
                        <div class="activity-time">${timeAgo(a.created_at)}</div>
                    </div>
                    ${a.points_change ? `<span class="activity-points">+${a.points_change}</span>` : ''}
                </div>
            `;
        }).join('');
    } catch (e) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-circle"></i><span>Could not load activity.</span></div>';
    }
}

// Edit Profile Modal
function openEditModal() {
    if (!profileData) return;
    document.getElementById('editDisplayName').value = profileData.display_name || '';
    document.getElementById('editBio').value = profileData.bio || '';
    document.getElementById('editUsername').value = profileData.username || '';
    document.getElementById('editError').style.display = 'none';
    // Update char counter
    const counter = document.getElementById('bioCharCount');
    if (counter) counter.textContent = (profileData.bio || '').length;
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

async function saveProfile() {
    const token = localStorage.getItem('djangoAuthToken');
    const body = {
        display_name: document.getElementById('editDisplayName').value.trim(),
        bio: document.getElementById('editBio').value.trim(),
        username: document.getElementById('editUsername').value.trim(),
    };

    try {
        const res = await fetch(`${PROFILE_API}/auth/profile/`, {
            method: 'PATCH',
            headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            closeEditModal();
            await loadProfile();
        } else {
            const err = await res.json();
            const msg = Object.values(err).flat().join(' ');
            const errEl = document.getElementById('editError');
            errEl.textContent = msg || 'Failed to save. Try again.';
            errEl.style.display = 'block';
        }
    } catch (e) {
        console.error('Save error:', e);
    }
}

async function uploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5MB'); return; }

    const token = localStorage.getItem('djangoAuthToken');
    const form = new FormData();
    form.append('profile_image', file);

    try {
        const res = await fetch(`${PROFILE_API}/auth/profile/`, {
            method: 'PATCH',
            headers: { 'Authorization': `Token ${token}` },
            body: form
        });
        if (res.ok) {
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById('avatarDisplay').innerHTML = `<img src="${e.target.result}" alt="avatar">`;
            };
            reader.readAsDataURL(file);
        }
    } catch (e) {
        console.error('Avatar upload error:', e);
    }
}

// Helpers
function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
window.saveProfile = saveProfile;
window.uploadAvatar = uploadAvatar;

// Close modal on outside click
window.addEventListener('click', e => {
    if (e.target.id === 'editModal') closeEditModal();
});
