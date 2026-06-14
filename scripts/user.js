// ARTX — Profile Page Script

const PROFILE_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let profileData = null;

const ACTIVITY_ICONS = {
    prestige_gained:    { icon: 'fa-star',         color: 'linear-gradient(135deg,#f5a623,#ffd700)' },
    level_up:           { icon: 'fa-arrow-trend-up',color: 'linear-gradient(135deg,#4caf50,#8bc34a)' },
    tier_upgrade:       { icon: 'fa-crown',         color: 'linear-gradient(135deg,#ff9800,#ffc107)' },
    tournament_entry:   { icon: 'fa-trophy',        color: 'linear-gradient(135deg,#2196f3,#667eea)' },
    tournament_win:     { icon: 'fa-medal',         color: 'linear-gradient(135deg,#ffd700,#ff9800)' },
    alliance_join:      { icon: 'fa-users',         color: 'linear-gradient(135deg,#9c27b0,#673ab7)' },
    alliance_create:    { icon: 'fa-flag',          color: 'linear-gradient(135deg,#9c27b0,#e91e63)' },
    payment_made:       { icon: 'fa-credit-card',   color: 'linear-gradient(135deg,#22c1c3,#667eea)' },
    submission_success: { icon: 'fa-check-double',  color: 'linear-gradient(135deg,#4caf50,#00bcd4)' },
    submission_failed:  { icon: 'fa-xmark',         color: 'linear-gradient(135deg,#f44336,#e91e63)' },
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = '/pages/auth.html'; return; }
    await loadProfile();
    await loadActivities();
});

// ── Load Profile ──────────────────────────────────────────────
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

// ── Render Profile ────────────────────────────────────────────
function renderProfile(u, rank) {
    // ── Hero
    setText('profileDisplayName', u.display_name || u.username);
    setText('profileUsername', `@${u.username}`);
    setText('profileTier', u.access_tier);
    setText('profileRank', u.power_rank);
    setText('heroBio', u.bio || '');
    if (u.is_verified) show('profileVerified');

    // Level orb
    const lvlOrb = document.getElementById('avatarLevel');
    if (lvlOrb) lvlOrb.querySelector('strong').textContent = u.level;

    // Avatar
    if (u.profile_image) {
        document.getElementById('avatarDisplay').innerHTML =
            `<img src="${u.profile_image}" alt="avatar">`;
        // Modal avatar
        const ma = document.getElementById('modalAvatar');
        if (ma) ma.innerHTML = `<img src="${u.profile_image}" alt="avatar">`;
        // Nav avatar
        const na = document.getElementById('navAvatarImg');
        if (na) na.innerHTML = `<img src="${u.profile_image}" alt="avatar">`;
    }

    // ── Tier-colored avatar ring
    if (window.TIER_COLORS) {
        const ringColor = window.TIER_COLORS[u.access_tier] || '#7cba3d';
        const ring = document.getElementById('avatarRing');
        if (ring) ring.style.background = `conic-gradient(${ringColor}, #22c1c3, ${ringColor})`;
    }

    // ── Stat strip orbs
    setText('statPrestige', u.prestige_points.toLocaleString());
    setText('statLevel', u.level);
    setText('statStreak', u.current_streak);
    setText('statWins', u.tournament_wins);
    setText('statSuccessRate', `${u.success_rate}%`);
    setText('statEarnings', `K${parseFloat(u.total_earnings).toFixed(0)}`);

    // Animate SVG orb rings (visual only, fill based on relative scale)
    animateOrb('orbFill0', Math.min(u.prestige_points / 5000, 1));
    animateOrb('orbFill1', Math.min(u.level / 50, 1));
    animateOrb('orbFill2', Math.min(u.current_streak / 30, 1));
    animateOrb('orbFill3', Math.min(u.tournament_wins / 20, 1));
    animateOrb('orbFill4', u.success_rate / 100);
    animateOrb('orbFill5', Math.min(parseFloat(u.total_earnings) / 10000, 1));

    // ── About
    setText('profileBio', u.bio || 'No bio yet.');
    setText('profileEmail', u.email);
    setText('profileJoined', new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    setText('profileVerLevel', u.verification_level);

    // ── Prestige XP bar
    const pts = u.prestige_points;
    const milestones = [0, 200, 500, 1000, 1500, 2500, 5000, 10000];
    const next = milestones.find(m => m > pts) || milestones[milestones.length - 1];
    const prev = [...milestones].reverse().find(m => m <= pts) || 0;
    const pct  = prev === next ? 100 : ((pts - prev) / (next - prev)) * 100;
    setText('prestigePoints', pts.toLocaleString());
    setText('prestigeNext', next.toLocaleString());
    setTimeout(() => {
        const bar = document.getElementById('prestigeBar');
        if (bar) bar.style.width = `${Math.min(pct, 100)}%`;
    }, 400);

    // ── Tier road nodes
    const tierOrder = ['Bronze','Silver','Gold','Platinum','Diamond','Elite','Legendary'];
    const activeIdx = tierOrder.indexOf(u.access_tier);
    document.querySelectorAll('.tr-node').forEach((node, i) => {
        node.classList.remove('active', 'passed', 'legendary');
        if (i < activeIdx)  node.classList.add('passed');
        if (i === activeIdx) node.classList.add('active');
        if (node.dataset.tier === 'Legendary') node.classList.add('legendary');
    });
    // Color passed lines
    document.querySelectorAll('.tr-line').forEach((line, i) => {
        line.classList.toggle('passed', i < activeIdx);
    });

    // ── Performance
    const wrong = u.total_submissions - u.successful_submissions;
    setText('perfSubmissions', u.total_submissions);
    setText('perfCorrect', u.successful_submissions);
    setText('perfWrong', wrong);
    setText('perfWins', u.tournament_wins);
    setText('successRateLabel', `${u.success_rate}%`);
    setTimeout(() => {
        const bar = document.getElementById('successBar');
        if (bar) bar.style.width = `${u.success_rate}%`;
    }, 600);

    // Donut chart
    if (window.buildDonut) {
        setTimeout(() => buildDonut(u.successful_submissions, u.total_submissions), 400);
    }

    // ── Nav dropdown
    setText('menuUsername', u.display_name || u.username);
    setText('menuTier', `${u.access_tier} Tier`);
    setText('menuPrestige', u.prestige_points.toLocaleString());
    setText('menuStreak', u.current_streak);
    setText('navWallet', `K${parseFloat(u.total_earnings).toFixed(0)}`);

    // ── Social
    renderSocial(u.social_connections || {});
}

function animateOrb(id, fraction) {
    const circ = 2 * Math.PI * 25; // r=25
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => {
        el.style.strokeDasharray = `${fraction * circ} ${circ}`;
    }, 500);
}

// ── Social Connections ────────────────────────────────────────
function renderSocial(connections) {
    const list = document.getElementById('socialList');
    const platforms = Object.entries(connections).filter(([, v]) => v.connected);

    if (!platforms.length) {
        list.innerHTML = '<div class="empty-msg"><i class="fas fa-plug-circle-xmark"></i><span>No accounts linked</span></div>';
        return;
    }

    const icons = {
        twitter:'fa-twitter', instagram:'fa-instagram',
        youtube:'fa-youtube', tiktok:'fa-tiktok', facebook:'fa-facebook'
    };

    list.innerHTML = platforms.map(([p, d]) => `
        <div class="social-card">
            <i class="fab ${icons[p] || 'fa-link'}"></i>
            <span class="sc-name">${p.charAt(0).toUpperCase()+p.slice(1)}</span>
            <span class="sc-handle">@${d.username}</span>
            ${d.verified ? '<i class="fas fa-check-circle sc-verified"></i>' : ''}
        </div>
    `).join('');
}

// ── Activity Feed ─────────────────────────────────────────────
async function loadActivities() {
    const token = localStorage.getItem('djangoAuthToken');
    const list  = document.getElementById('activityList');
    try {
        const res = await fetch(`${PROFILE_API}/auth/activities/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const activities = data.results || data;

        if (!activities.length) {
            list.innerHTML = '<div class="empty-msg"><i class="fas fa-bolt-lightning"></i><span>No activity yet</span></div>';
            return;
        }

        const countEl = document.getElementById('activityCount');
        if (countEl) countEl.textContent = activities.length > 15 ? '15+' : activities.length;

        list.innerHTML = activities.slice(0, 15).map((a, i) => {
            const meta = ACTIVITY_ICONS[a.activity_type] || { icon:'fa-circle', color:'linear-gradient(135deg,#555,#777)' };
            return `
                <div class="feed-item" style="animation-delay:${i * 0.05}s">
                    <div class="feed-icon" style="background:${meta.color}">
                        <i class="fas ${meta.icon}"></i>
                    </div>
                    <div class="feed-body">
                        <div class="feed-desc">${a.description}</div>
                        <div class="feed-time">${timeAgo(a.created_at)}</div>
                    </div>
                    ${a.points_change ? `<span class="feed-pts">+${a.points_change}</span>` : ''}
                </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = '<div class="empty-msg"><i class="fas fa-triangle-exclamation"></i><span>Could not load activity</span></div>';
    }
}

// ── Edit Modal ────────────────────────────────────────────────
function openEditModal() {
    if (!profileData) return;
    document.getElementById('editDisplayName').value = profileData.display_name || '';
    document.getElementById('editBio').value         = profileData.bio || '';
    document.getElementById('editUsername').value    = profileData.username || '';
    document.getElementById('bioCharCount').textContent = (profileData.bio || '').length;
    document.getElementById('editError').style.display = 'none';
    document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('open');
}

async function saveProfile() {
    const token = localStorage.getItem('djangoAuthToken');
    const body = {
        display_name: document.getElementById('editDisplayName').value.trim(),
        bio:          document.getElementById('editBio').value.trim(),
        username:     document.getElementById('editUsername').value.trim(),
    };
    const saveBtn = document.querySelector('.mbtn-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }

    try {
        const res = await fetch(`${PROFILE_API}/auth/profile/`, {
            method: 'PATCH',
            headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            closeEditModal();
            if (window.showToast) showToast('✅ Profile updated!');
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
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Changes'; }
    }
}

// ── Avatar Upload ─────────────────────────────────────────────
async function uploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { if (window.showToast) showToast('⚠️ Max file size is 5MB'); return; }

    const token = localStorage.getItem('djangoAuthToken');
    const form  = new FormData();
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
                const ma = document.getElementById('modalAvatar');
                if (ma) ma.innerHTML = `<img src="${e.target.result}" alt="avatar">`;
                const na = document.getElementById('navAvatarImg');
                if (na) na.innerHTML = `<img src="${e.target.result}" alt="avatar">`;
            };
            reader.readAsDataURL(file);
            if (window.showToast) showToast('📸 Avatar updated!');
        }
    } catch (e) { console.error('Avatar upload error:', e); }
}

// ── Helpers ───────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'inline-flex';
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000)return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

// ── Exports ───────────────────────────────────────────────────
window.openEditModal  = openEditModal;
window.closeEditModal = closeEditModal;
window.saveProfile    = saveProfile;
window.uploadAvatar   = uploadAvatar;

// Bio char counter
document.addEventListener('DOMContentLoaded', () => {
    const bio     = document.getElementById('editBio');
    const counter = document.getElementById('bioCharCount');
    if (bio && counter) bio.addEventListener('input', () => counter.textContent = bio.value.length);
});
