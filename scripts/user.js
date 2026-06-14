// ARTX — Profile  ·  user.js

const PROFILE_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let profileData = null;

const ACT_META = {
    prestige_gained:    { icon: 'fa-star',         bg: 'linear-gradient(135deg,#b45309,#f59e0b)' },
    level_up:           { icon: 'fa-arrow-trend-up',bg: 'linear-gradient(135deg,#16a34a,#4ade80)' },
    tier_upgrade:       { icon: 'fa-crown',         bg: 'linear-gradient(135deg,#92400e,#f59e0b)' },
    tournament_entry:   { icon: 'fa-trophy',        bg: 'linear-gradient(135deg,#1d4ed8,#60a5fa)' },
    tournament_win:     { icon: 'fa-medal',         bg: 'linear-gradient(135deg,#92400e,#fbbf24)' },
    alliance_join:      { icon: 'fa-users',         bg: 'linear-gradient(135deg,#6d28d9,#a78bfa)' },
    alliance_create:    { icon: 'fa-flag',          bg: 'linear-gradient(135deg,#6d28d9,#f472b6)' },
    payment_made:       { icon: 'fa-credit-card',   bg: 'linear-gradient(135deg,#0e7490,#22d3ee)' },
    submission_success: { icon: 'fa-check-double',  bg: 'linear-gradient(135deg,#15803d,#4ade80)' },
    submission_failed:  { icon: 'fa-xmark',         bg: 'linear-gradient(135deg,#b91c1c,#f87171)' },
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = '/pages/auth.html'; return; }
    await loadProfile();
    await loadActivities();
});

// ── Load profile ──────────────────────────────────────────────
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

// ── Render ────────────────────────────────────────────────────
function renderProfile(u, rank) {

    // Identity
    set('profileDisplayName', u.display_name || u.username);
    set('profileUsername', `@${u.username}`);
    set('profileTier', u.access_tier);
    set('profileRank', u.power_rank);
    set('heroBio', u.bio || '');
    set('profileBio', u.bio || 'No bio yet.');
    set('profileEmail', u.email);
    set('profileJoined', new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
    set('profileVerLevel', u.verification_level);
    if (u.is_verified) show('profileVerified');

    // Avatar level orb
    const lvl = document.getElementById('avatarLevel');
    if (lvl) lvl.querySelector('b').textContent = u.level;

    // Avatar image
    if (u.profile_image) {
        setAvatarImg(u.profile_image);
    }

    // Tier palette (cover + ring colour)
    if (window.applyTierPalette) applyTierPalette(u.access_tier);

    // Stats row
    set('statPrestige', u.prestige_points.toLocaleString());
    set('statLevel', u.level);
    set('statStreak', u.current_streak);
    set('statWins', u.tournament_wins);
    set('statSuccessRate', `${u.success_rate}%`);
    set('statEarnings', `K${parseFloat(u.total_earnings).toFixed(0)}`);

    // Prestige XP bar
    const pts = u.prestige_points;
    const milestones = [0, 200, 500, 1000, 1500, 2500, 5000, 10000];
    const next = milestones.find(m => m > pts) || milestones[milestones.length - 1];
    const prev = [...milestones].reverse().find(m => m <= pts) || 0;
    const pct  = prev === next ? 100 : ((pts - prev) / (next - prev)) * 100;
    set('prestigePoints', pts.toLocaleString());
    set('prestigeNext', next.toLocaleString());
    delay(() => { setW('prestigeBar', Math.min(pct, 100)); }, 350);

    // Tier nodes
    const TIERS = ['Bronze','Silver','Gold','Platinum','Diamond','Elite','Legendary'];
    const activeIdx = TIERS.indexOf(u.access_tier);
    document.querySelectorAll('.tnode').forEach((n, i) => {
        n.classList.remove('active','passed','legendary');
        if (i < activeIdx) n.classList.add('passed');
        if (i === activeIdx) n.classList.add('active');
        if (n.dataset.tier === 'Legendary') n.classList.add('legendary');
    });
    document.querySelectorAll('.tline').forEach((l, i) => {
        l.classList.toggle('passed', i < activeIdx);
    });

    // Performance
    const wrong = u.total_submissions - u.successful_submissions;
    set('perfSubmissions', u.total_submissions);
    set('perfCorrect', u.successful_submissions);
    set('perfWrong', wrong);
    set('perfWins', u.tournament_wins);
    set('successRateLabel', `${u.success_rate}%`);
    set('dlCorrect', u.successful_submissions);
    set('dlWrong', wrong);
    set('dlTotal', u.total_submissions);
    set('donutPct', `${u.success_rate}%`);
    delay(() => { setW('successBar', u.success_rate); }, 500);
    delay(() => { buildDonut(u.successful_submissions, u.total_submissions); }, 500);

    // Nav user menu
    set('menuUsername', u.display_name || u.username);
    set('menuTier', `${u.access_tier} Tier`);
    set('menuPrestige', u.prestige_points.toLocaleString());
    set('menuStreak', u.current_streak);
    set('menuEarnings', `K${parseFloat(u.total_earnings).toFixed(0)}`);

    // Social
    renderSocial(u.social_connections || {});
}

function setAvatarImg(src) {
    const img = `<img src="${src}" alt="avatar">`;
    ['avatarDisplay','modalAvatar','umAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = img;
    });
    const na = document.getElementById('navAvatar');
    if (na) na.innerHTML = img;
}

// Donut
function buildDonut(correct, total) {
    const circ = 2 * Math.PI * 52; // r=52
    const cFrac = total > 0 ? correct / total : 0;
    const wFrac = total > 0 ? (total - correct) / total : 0;
    const dc = document.getElementById('dCorrect');
    const dw = document.getElementById('dWrong');
    if (!dc || !dw) return;
    dc.style.strokeDasharray = `${cFrac * circ} ${circ}`;
    dc.style.strokeDashoffset = String(circ * 0.25);
    dw.style.strokeDasharray = `${wFrac * circ} ${circ}`;
    dw.style.strokeDashoffset = String(circ * 0.25 - cFrac * circ);
}

// ── Social ────────────────────────────────────────────────────
function renderSocial(connections) {
    const list = document.getElementById('socialList');
    const platforms = Object.entries(connections).filter(([, v]) => v.connected);
    if (!platforms.length) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-link-slash"></i><span>No accounts linked</span></div>';
        return;
    }
    const ICONS = { twitter:'fa-twitter', instagram:'fa-instagram', youtube:'fa-youtube', tiktok:'fa-tiktok', facebook:'fa-facebook' };
    list.innerHTML = platforms.map(([p, d]) => `
        <div class="social-row">
            <i class="fab ${ICONS[p] || 'fa-link'}"></i>
            <span class="soc-name">${p[0].toUpperCase()+p.slice(1)}</span>
            <span class="soc-handle">@${d.username}</span>
            ${d.verified ? '<i class="fas fa-circle-check soc-check"></i>' : ''}
        </div>`).join('');
}

// ── Activity ──────────────────────────────────────────────────
async function loadActivities() {
    const token = localStorage.getItem('djangoAuthToken');
    const list  = document.getElementById('activityList');
    try {
        const res = await fetch(`${PROFILE_API}/auth/activities/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const items = (data.results || data).slice(0, 15);

        if (!items.length) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-bolt-lightning"></i><span>No activity yet</span></div>';
            return;
        }

        set('activityCount', items.length >= 15 ? '15+' : items.length);

        list.innerHTML = items.map((a, i) => {
            const m = ACT_META[a.activity_type] || { icon:'fa-circle', bg:'linear-gradient(135deg,#6b7280,#9ca3af)' };
            return `
            <div class="act-item" style="animation-delay:${i*0.04}s">
                <div class="act-icon" style="background:${m.bg}">
                    <i class="fas ${m.icon}"></i>
                </div>
                <div class="act-body">
                    <div class="act-desc">${a.description}</div>
                    <div class="act-time">${timeAgo(a.created_at)}</div>
                </div>
                ${a.points_change ? `<span class="act-pts">+${a.points_change}</span>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = '<div class="empty-state"><i class="fas fa-triangle-exclamation"></i><span>Could not load activity</span></div>';
    }
}

// ── Edit modal ────────────────────────────────────────────────
function openEditModal() {
    if (!profileData) return;
    document.getElementById('editDisplayName').value = profileData.display_name || '';
    document.getElementById('editUsername').value    = profileData.username || '';
    document.getElementById('editBio').value         = profileData.bio || '';
    document.getElementById('bioCount').textContent  = (profileData.bio || '').length;
    document.getElementById('editError').style.display = 'none';
    document.getElementById('editModal').classList.add('open');
}

function closeEditModal() {
    document.getElementById('editModal').classList.remove('open');
}

async function saveProfile() {
    const token = localStorage.getItem('djangoAuthToken');
    const btn   = document.querySelector('.mbtn.primary');
    const body  = {
        display_name: document.getElementById('editDisplayName').value.trim(),
        bio:          document.getElementById('editBio').value.trim(),
        username:     document.getElementById('editUsername').value.trim(),
    };
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }
    try {
        const res = await fetch(`${PROFILE_API}/auth/profile/`, {
            method: 'PATCH',
            headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            closeEditModal();
            showToast('Profile updated ✓');
            await loadProfile();
        } else {
            const err = await res.json();
            const msg = Object.values(err).flat().join(' ');
            const el = document.getElementById('editError');
            el.textContent = msg || 'Save failed. Try again.';
            el.style.display = 'block';
        }
    } catch (e) { console.error(e); }
    finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Changes'; }
    }
}

// ── Avatar upload ─────────────────────────────────────────────
async function uploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Max file size is 5 MB'); return; }
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
            reader.onload = e => setAvatarImg(e.target.result);
            reader.readAsDataURL(file);
            showToast('Avatar updated ✓');
        }
    } catch (e) { console.error(e); }
}

// ── Helpers ───────────────────────────────────────────────────
function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function show(id)     { const el = document.getElementById(id); if (el) el.style.display = 'inline-flex'; }
function setW(id, pct){ const el = document.getElementById(id); if (el) el.style.width = `${pct}%`; }
function delay(fn, ms){ setTimeout(fn, ms); }

function timeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    if (diff < 604800000)return `${Math.floor(diff/86400000)}d ago`;
    return new Date(d).toLocaleDateString();
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// Exports
window.openEditModal  = openEditModal;
window.closeEditModal = closeEditModal;
window.saveProfile    = saveProfile;
window.uploadAvatar   = uploadAvatar;
window.showToast      = showToast;
