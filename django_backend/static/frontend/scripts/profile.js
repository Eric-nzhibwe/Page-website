// ─────────────────────────────────────────────────────────────────────────────
//  PAGE · profile.js
//  Self-contained profile page logic:
//    • Load & render own profile or another user's profile
//    • Edit profile (display name, username, bio, location, website)
//    • Upload avatar (base64 → JSON POST)
//    • Upload cover photo (base64 → PATCH)
//    • Follow / unfollow
//    • Followers / following modal
//    • Delete account
//    • Activity feed with filter tabs
//    • Tier palette applied from theme system
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

/* ── API base ───────────────────────────────────────────────── */
const PF_API = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

/* ── Auth header ────────────────────────────────────────────── */
function pfAuth() {
    return window._pageAuthHeader ? window._pageAuthHeader() : null;
}
async function pfAuthAsync() {
    return window._pageAuthHeaderAsync
        ? await window._pageAuthHeaderAsync()
        : pfAuth();
}
function pfHeaders(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const a = pfAuth();
    if (a) h['Authorization'] = a;
    return h;
}
async function pfHeadersAsync(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const a = await pfAuthAsync();
    if (a) h['Authorization'] = a;
    return h;
}

/* ── State ──────────────────────────────────────────────────── */
let _pfData         = null;   // current profile object
let _pfIsOwn        = true;   // are we viewing our own profile?
let _pfViewId       = null;   // id of viewed user (if other profile)
let _pfIsFollowing  = false;
let _pfAllActs      = [];
let _pfActShown     = 10;
const PF_PAGE_SIZE  = 10;
let _pfCurrentFilter = 'all';
let _pfFollowTab    = 'followers';

/* ── Activity metadata ─────────────────────────────────────── */
const PF_ACT_META = {
    prestige_gained:    { icon: 'fa-star',           bg: 'linear-gradient(135deg,#b45309,#f59e0b)' },
    level_up:           { icon: 'fa-arrow-trend-up',  bg: 'linear-gradient(135deg,#16a34a,#4ade80)' },
    tier_upgrade:       { icon: 'fa-crown',           bg: 'linear-gradient(135deg,#92400e,#f59e0b)' },
    tournament_entry:   { icon: 'fa-trophy',          bg: 'linear-gradient(135deg,#1d4ed8,#60a5fa)' },
    tournament_win:     { icon: 'fa-medal',           bg: 'linear-gradient(135deg,#92400e,#fbbf24)' },
    alliance_join:      { icon: 'fa-users',           bg: 'linear-gradient(135deg,#6d28d9,#a78bfa)' },
    alliance_create:    { icon: 'fa-flag',            bg: 'linear-gradient(135deg,#6d28d9,#f472b6)' },
    payment_made:       { icon: 'fa-credit-card',     bg: 'linear-gradient(135deg,#0e7490,#22d3ee)' },
    submission_success: { icon: 'fa-check-double',    bg: 'linear-gradient(135deg,#15803d,#4ade80)' },
    submission_failed:  { icon: 'fa-xmark',           bg: 'linear-gradient(135deg,#b91c1c,#f87171)' },
};

const PF_ACT_FILTER_TYPES = {
    challenge: ['submission_success', 'submission_failed'],
    win:       ['tournament_win', 'tier_upgrade', 'level_up'],
    social:    ['alliance_join', 'alliance_create'],
};

const PF_MILESTONES = [0, 200, 500, 1000, 1500, 2500, 5000, 10000];
const PF_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Elite', 'Legendary'];

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
    // Auth guard
    const authed = window._pageIsAuthed ? window._pageIsAuthed() :
        !!(localStorage.getItem('djangoAuthToken') || localStorage.getItem('firebaseIdToken'));
    if (!authed) { window.location.replace('/pages/auth.html'); return; }

    // Stamp avatar immediately from localStorage (no flash)
    pfBootAvatar();

    // Determine own vs other profile
    const params = new URLSearchParams(window.location.search);
    const viewId = params.get('id');
    const myId   = localStorage.getItem('userId') ||
                   (JSON.parse(localStorage.getItem('pageUser') || '{}').id || null);

    _pfIsOwn   = !viewId || String(viewId) === String(myId);
    _pfViewId  = viewId || myId;

    if (_pfIsOwn) {
        await pfLoadOwnProfile();
        await pfLoadActivities();
    } else {
        await pfLoadOtherProfile(viewId);
    }

    // Wire tab pills
    document.getElementById('pfPerfTabs').addEventListener('click', e => {
        const btn = e.target.closest('.pf-tab');
        if (!btn) return;
        document.querySelectorAll('.pf-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.pf-tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
        // Animate donut when chart tab opens
        if (btn.dataset.tab === 'pf-tab-donut' && _pfData) pfBuildDonut(_pfData);
    });

    // Wire activity filter bar
    document.querySelector('.pf-act-filters').addEventListener('click', e => {
        const btn = e.target.closest('.pf-act-filter');
        if (!btn) return;
        document.querySelectorAll('.pf-act-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _pfCurrentFilter = btn.dataset.filter;
        _pfActShown = PF_PAGE_SIZE;
        pfRenderActivityItems(pfFilteredActs());
    });

    // Avatar change broadcast listener
    window.addEventListener('page:avatarChanged', e => {
        if (e.detail?.url) pfApplyAvatarEverywhere(e.detail.url);
    });
});

/* ── Boot avatar from localStorage ─────────────────────────── */
function pfBootAvatar() {
    try {
        const stored = JSON.parse(localStorage.getItem('pageUser') || '{}');
        const url = stored.profile_image_url || stored.profile_image || null;
        if (url) {
            pfApplyAvatarEverywhere(url);
        } else {
            const name    = stored.display_name || stored.username || '';
            const initial = name ? name.charAt(0).toUpperCase() : null;
            if (initial && window.pageLetterAvatarHTML) {
                const html = window.pageLetterAvatarHTML(initial);
                ['pfAv', 'pfModalAv', 'navAvatar'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.innerHTML = html;
                });
            }
        }
    } catch (_) { /* non-critical */ }
}

/* ═══════════════════════════════════════════════════════════════
   LOAD PROFILE  (own)
═══════════════════════════════════════════════════════════════ */
async function pfLoadOwnProfile() {
    try {
        const res = await fetch(`${PF_API}/auth/stats/`, { headers: pfHeaders() });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        _pfData = data.user;
        pfRender(_pfData, data.rank);
        await pfLoadFollowCounts(_pfData.id, false);
    } catch (e) {
        console.error('[PF] profile load error', e);
        pfToast('Could not load profile. Try refreshing.', 'error');
    }
}

/* ═══════════════════════════════════════════════════════════════
   LOAD PROFILE  (other user)
═══════════════════════════════════════════════════════════════ */
async function pfLoadOtherProfile(userId) {
    // Hide own-profile controls
    const editBtn     = document.getElementById('pfEditBtn');
    const coverBtn    = document.getElementById('pfCoverBtn');
    const avCam       = document.getElementById('pfAvCam');
    const dangerZone  = document.getElementById('pfDangerZone');
    const followBtn   = document.getElementById('pfFollowBtn');
    if (editBtn)    editBtn.style.display    = 'none';
    if (coverBtn)   coverBtn.style.display   = 'none';
    if (avCam)      avCam.style.display      = 'none';
    if (dangerZone) dangerZone.style.display = 'none';
    if (followBtn)  followBtn.style.display  = 'inline-flex';

    try {
        // Fetch the user's public profile via discover endpoint
        const res = await fetch(`${PF_API}/auth/discover/?limit=200`, { headers: pfHeaders() });
        if (res.ok) {
            const list = await res.json();
            const users = Array.isArray(list) ? list : (list.results || []);
            const u = users.find(x => String(x.id) === String(userId));
            if (u) pfRenderOther(u);
        }
        await pfLoadFollowCounts(userId, true);
    } catch (e) {
        console.error('[PF] other profile load error', e);
    }
}

/* ═══════════════════════════════════════════════════════════════
   RENDER  (own full profile)
═══════════════════════════════════════════════════════════════ */
function pfRender(u, rank) {
    _pfData = u;
    window._lastProfileData = u; // shared with any other scripts

    // Identity
    pfSet('pfName',     u.display_name || u.username);
    pfSet('pfHandle',   `@${u.username}`);
    pfSet('pfTier',     u.access_tier || 'Bronze');
    pfSet('pfRank',     u.power_rank  || 'Novice');
    pfSet('pfBio',      u.bio || '');
    pfSet('pfAboutBio', u.bio || 'No bio yet.');
    pfSet('pfEmail',    u.email || '—');
    pfSet('pfJoined',   u.created_at ? new Date(u.created_at).toLocaleDateString('en-US', { month:'long', year:'numeric' }) : '—');
    if (u.is_verified) pfShow('pfVerified');

    // Location / website
    if (u.location) { pfSet('pfLocation', u.location); pfShow('pfLocationRow'); }
    if (u.website)  {
        pfShow('pfWebsiteRow');
        const a = document.getElementById('pfWebsite');
        if (a) { a.textContent = u.website; a.href = u.website; }
    }

    // Level orb
    const lvl = document.getElementById('pfLevel');
    if (lvl) lvl.querySelector('b').textContent = u.level || 1;

    // Avatar
    const av = u.profile_image_url || u.profile_image || null;
    const avUrl = av ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(av) : av) : null;
    if (avUrl) pfApplyAvatarEverywhere(avUrl);

    // Tier palette (cover gradient + ring)
    pfApplyTierPalette(u.access_tier);

    // Stats bar
    pfSet('pfPrestige',  u.prestige_points.toLocaleString());
    pfSet('pfLevel2',    u.level);
    pfSetHTML('pfStreak', `${u.current_streak} <i class="fas fa-fire"></i>`);
    pfSet('pfWins',     u.tournament_wins);
    pfSet('pfAccuracy', `${u.success_rate}%`);
    pfSet('pfEarnings', `K${parseFloat(u.total_earnings || 0).toFixed(0)}`);
    pfSet('pfFollowers', u.followers_count ?? 0);
    pfSet('pfFollowing', u.following_count ?? 0);

    // XP bar
    const pts  = u.prestige_points;
    const next = PF_MILESTONES.find(m => m > pts) || PF_MILESTONES[PF_MILESTONES.length - 1];
    const prev = [...PF_MILESTONES].reverse().find(m => m <= pts) || 0;
    const pct  = prev === next ? 100 : ((pts - prev) / (next - prev)) * 100;
    pfSet('pfXpCur',  pts.toLocaleString());
    pfSet('pfXpNext', next.toLocaleString());
    setTimeout(() => pfSetWidth('pfXpFill', Math.min(pct, 100)), 350);

    // Tier nodes
    const activeIdx = PF_TIERS.indexOf(u.access_tier);
    document.querySelectorAll('.pf-tnode').forEach((n, i) => {
        n.classList.remove('active', 'passed');
        if (i < activeIdx) n.classList.add('passed');
        if (i === activeIdx) n.classList.add('active');
    });
    document.querySelectorAll('.pf-tline').forEach((l, i) => {
        l.classList.toggle('passed', i < activeIdx);
    });

    // Performance tab
    const wrong = u.total_submissions - u.successful_submissions;
    pfSet('pfKpiTotal',   u.total_submissions);
    pfSet('pfKpiCorrect', u.successful_submissions);
    pfSet('pfKpiWrong',   wrong);
    pfSet('pfKpiWins',    u.tournament_wins);
    pfSet('pfAccPct',     `${u.success_rate}%`);
    pfSet('pfDonutPct',   `${u.success_rate}%`);
    pfSet('pfDlCorrect',  u.successful_submissions);
    pfSet('pfDlWrong',    wrong);
    pfSet('pfDlTotal',    u.total_submissions);
    setTimeout(() => pfSetWidth('pfAccFill', u.success_rate), 500);
    setTimeout(() => pfBuildDonut(u), 500);

    // Page title
    document.title = `PAGE — ${u.display_name || u.username}`;

    // Remove skeleton shimmer
    document.querySelectorAll('.pf-sk').forEach(el => el.classList.add('loaded'));
}

/* ── Render other user (minimal) ───────────────────────────── */
function pfRenderOther(u) {
    _pfData = u;
    pfSet('pfName',     u.display_name || u.username);
    pfSet('pfHandle',   `@${u.username}`);
    pfSet('pfTier',     u.access_tier || 'Bronze');
    pfSet('pfRank',     u.power_rank  || '—');
    pfSet('pfBio',      u.bio || '');
    pfSet('pfAboutBio', u.bio || 'No bio yet.');
    pfSet('pfPrestige', (u.prestige_points || 0).toLocaleString());
    pfSet('pfLevel2',   u.level || 1);

    const av = u.profile_image_url || u.profile_image || null;
    const avUrl = av ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(av) : av) : null;
    if (avUrl) pfApplyAvatarEverywhere(avUrl);

    pfApplyTierPalette(u.access_tier);
    document.title = `PAGE — ${u.display_name || u.username}`;
    document.querySelectorAll('.pf-sk').forEach(el => el.classList.add('loaded'));
}

/* ═══════════════════════════════════════════════════════════════
   FOLLOW / UNFOLLOW
═══════════════════════════════════════════════════════════════ */
async function pfLoadFollowCounts(userId, checkFollowing = false) {
    try {
        const res = await fetch(`${PF_API}/social/follows/counts/?user_id=${userId}`, { headers: pfHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        pfSet('pfFollowers', data.followers_count ?? 0);
        pfSet('pfFollowing', data.following_count ?? 0);

        if (checkFollowing) {
            _pfIsFollowing = data.is_following;
            pfStyleFollowBtn(_pfIsFollowing);
        }
    } catch (_) { /* silent */ }
}

function pfStyleFollowBtn(isFollowing) {
    const btn = document.getElementById('pfFollowBtn');
    if (!btn) return;
    if (isFollowing) {
        btn.innerHTML = '<i class="fas fa-check"></i> Following';
        btn.classList.add('pf-btn--following');
        btn.classList.remove('pf-btn--primary');
    } else {
        btn.innerHTML = '<i class="fas fa-user-plus"></i> Follow';
        btn.classList.remove('pf-btn--following');
        btn.classList.add('pf-btn--primary');
    }
}

async function pfToggleFollow() {
    if (!_pfViewId) return;
    const headers = await pfHeadersAsync();
    const endpoint = _pfIsFollowing
        ? `${PF_API}/social/follows/unfollow/`
        : `${PF_API}/social/follows/follow/`;

    _pfIsFollowing = !_pfIsFollowing;
    pfStyleFollowBtn(_pfIsFollowing);

    try {
        const res = await fetch(endpoint, {
            method: 'POST', headers,
            body: JSON.stringify({ user_id: _pfViewId }),
        });
        if (!res.ok) {
            _pfIsFollowing = !_pfIsFollowing;
            pfStyleFollowBtn(_pfIsFollowing);
            return;
        }
        await pfLoadFollowCounts(_pfViewId, false);
    } catch {
        _pfIsFollowing = !_pfIsFollowing;
        pfStyleFollowBtn(_pfIsFollowing);
    }
}

/* ═══════════════════════════════════════════════════════════════
   EDIT PROFILE MODAL
═══════════════════════════════════════════════════════════════ */
function pfOpenEdit() {
    if (!_pfData) return;
    document.getElementById('pfEditName').value     = _pfData.display_name || '';
    document.getElementById('pfEditUsername').value = _pfData.username     || '';
    document.getElementById('pfEditBio').value      = _pfData.bio          || '';
    document.getElementById('pfBioCount').textContent = (_pfData.bio || '').length;
    document.getElementById('pfEditLocation').value = _pfData.location     || '';
    document.getElementById('pfEditWebsite').value  = _pfData.website      || '';
    document.getElementById('pfEditError').style.display = 'none';
    pfOpenModal('pfEditModal');
}
function pfCloseEdit() { pfCloseModal('pfEditModal'); }

async function pfSaveProfile() {
    const saveBtn = document.getElementById('pfSaveBtn');
    const body = {
        display_name: document.getElementById('pfEditName').value.trim(),
        username:     document.getElementById('pfEditUsername').value.trim(),
        bio:          document.getElementById('pfEditBio').value.trim(),
        location:     document.getElementById('pfEditLocation').value.trim() || undefined,
        website:      document.getElementById('pfEditWebsite').value.trim()  || undefined,
    };
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    document.getElementById('pfEditError').style.display = 'none';

    try {
        const headers = await pfHeadersAsync();
        const res = await fetch(`${PF_API}/auth/profile/`, {
            method: 'PATCH', headers, body: JSON.stringify(body),
        });
        if (res.ok) {
            pfCloseEdit();
            pfToast('Profile updated ✓');
            await pfLoadOwnProfile();
        } else {
            const err = await res.json();
            const msg = Object.values(err).flat().join(' ');
            const el = document.getElementById('pfEditError');
            el.textContent = msg || 'Save failed. Try again.';
            el.style.display = 'block';
        }
    } catch (e) {
        console.error(e);
        pfToast('Error saving profile.', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Changes';
    }
}

/* ═══════════════════════════════════════════════════════════════
   AVATAR UPLOAD  (base64 JSON POST)
═══════════════════════════════════════════════════════════════ */
async function pfUploadAvatar(input) {
    const file = input.files[0];
    if (!file) return;

    const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!ALLOWED.includes(file.type)) {
        pfToast('Use JPEG, PNG, GIF or WebP.', 'error'); input.value = ''; return;
    }
    if (file.size > 5 * 1024 * 1024) {
        pfToast('Max file size is 5 MB.', 'error'); input.value = ''; return;
    }

    pfToast('Processing…');

    let dataUri;
    try { dataUri = await pfResizeBase64(file, 256); }
    catch {
        pfToast('Could not process image. Try another file.', 'error');
        input.value = ''; return;
    }

    // Instant local preview
    pfApplyAvatarEverywhere(dataUri);
    pfToast('Uploading…');

    // Prefer DRF token (never expires) for uploads
    const drfToken = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    const fbToken  = localStorage.getItem('firebaseIdToken');
    const authVal  = drfToken ? `Token ${drfToken}` : (fbToken ? `FirebaseToken ${fbToken}` : null);

    if (!authVal) { pfToast('Not logged in. Please sign in again.', 'error'); return; }

    try {
        const res  = await fetch(`${PF_API}/auth/avatar/`, {
            method: 'POST',
            headers: { 'Authorization': authVal, 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar_base64: dataUri }),
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) { pfToast(data.error || 'Upload failed.', 'error'); return; }

        const imgUrl = data.profile_image_url || data.avatar_url || data.profile_image || dataUri;

        // Persist
        try {
            const stored = JSON.parse(localStorage.getItem('pageUser') || '{}');
            stored.profile_image     = imgUrl;
            stored.profile_image_url = imgUrl;
            stored.avatar_url        = imgUrl;
            localStorage.setItem('pageUser', JSON.stringify(stored));
        } catch (_) {}

        if (_pfData) {
            _pfData.profile_image     = imgUrl;
            _pfData.profile_image_url = imgUrl;
        }

        pfApplyAvatarEverywhere(imgUrl);
        window.dispatchEvent(new CustomEvent('page:avatarChanged', { detail: { url: imgUrl } }));
        pfToast('Profile photo updated ✓');
    } catch (err) {
        console.error(err);
        pfToast('Upload failed. Check your connection.', 'error');
    }

    input.value = '';
}

/* ── Resize helper ─────────────────────────────────────────── */
function pfResizeBase64(file, size = 256) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.onload  = e => {
            const img = new Image();
            img.onerror = () => reject(new Error('Image load error'));
            img.onload  = () => {
                const side = Math.min(img.width, img.height);
                const sx = (img.width  - side) / 2;
                const sy = (img.height - side) / 2;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = size;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, size, size);
                ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
                resolve(canvas.toDataURL('image/jpeg', 0.88));
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

/* ── Apply avatar to every slot on the page ────────────────── */
function pfApplyAvatarEverywhere(imgUrl) {
    if (!imgUrl) return;
    const resolved = (typeof resolveMediaUrl === 'function') ? resolveMediaUrl(imgUrl) : imgUrl;

    const fallback = `(function(){
        try{var u=JSON.parse(localStorage.getItem('pageUser')||'{}');
        var n=(u.display_name||u.username||'?').charAt(0).toUpperCase();
        if(window.pageLetterAvatar)return window.pageLetterAvatar(n);
        var s=document.createElement('span');
        s.style='display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#374151;color:#fff;font-weight:700;font-size:14px;';
        s.textContent=n;return s;}catch(e){var s2=document.createElement('span');s2.textContent='?';return s2;}
    })()`;

    const imgTag = `<img src="${resolved}" alt="avatar"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;"
        onerror="this.replaceWith(${fallback})">`;

    ['pfAv', 'pfModalAv', 'navAvatar'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = imgTag;
    });

    document.querySelectorAll('[data-current-user-avatar]').forEach(el => { el.innerHTML = imgTag; });
}

/* ═══════════════════════════════════════════════════════════════
   COVER UPLOAD
═══════════════════════════════════════════════════════════════ */
async function pfUploadCover(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
        pfToast('Cover image must be under 8 MB', 'error'); return;
    }

    // Instant local preview
    const reader = new FileReader();
    reader.onload = e => {
        const cover = document.getElementById('pfCover');
        if (cover) {
            cover.style.backgroundImage    = `url(${e.target.result})`;
            cover.style.backgroundSize     = 'cover';
            cover.style.backgroundPosition = 'center';
        }
    };
    reader.readAsDataURL(file);

    // Encode for upload
    let coverBase64;
    try { coverBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onerror = () => rej(); r.onload = e => res(e.target.result); r.readAsDataURL(file); }); }
    catch { pfToast('Cover saved locally', 'info'); input.value = ''; return; }

    const drfToken = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    const fbToken  = localStorage.getItem('firebaseIdToken');
    const authVal  = drfToken ? `Token ${drfToken}` : (fbToken ? `FirebaseToken ${fbToken}` : null);
    if (!authVal) { input.value = ''; return; }

    try {
        const res = await fetch(`${PF_API}/auth/profile/`, {
            method: 'PATCH',
            headers: { 'Authorization': authVal, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cover_image_base64: coverBase64 }),
        });
        pfToast(res.ok ? 'Cover updated ✓' : 'Cover saved locally', res.ok ? 'success' : 'info');
    } catch { pfToast('Cover saved locally', 'info'); }

    input.value = '';
}

/* ═══════════════════════════════════════════════════════════════
   DELETE ACCOUNT
═══════════════════════════════════════════════════════════════ */
let _pfDeleteUsername = '';

function pfConfirmDeleteAccount() {
    _pfDeleteUsername = _pfData?.username || '';
    const prompt = document.getElementById('pfDeletePrompt');
    if (prompt) prompt.textContent = _pfDeleteUsername;
    document.getElementById('pfDeleteConfirm').value = '';
    document.getElementById('pfDeleteConfirmBtn').disabled = true;
    document.getElementById('pfDeleteError').style.display = 'none';
    pfOpenModal('pfDeleteModal');
}
function pfCloseDelete() { pfCloseModal('pfDeleteModal'); }

function pfCheckDeleteConfirm(val) {
    document.getElementById('pfDeleteConfirmBtn').disabled = val.trim() !== _pfDeleteUsername;
}

async function pfDeleteAccount() {
    const btn = document.getElementById('pfDeleteConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting…';
    document.getElementById('pfDeleteError').style.display = 'none';

    try {
        const headers = await pfHeadersAsync();
        const res = await fetch(`${PF_API}/auth/profile/delete/`, { method: 'DELETE', headers });

        if (res.ok || res.status === 204) {
            // Wipe local storage and redirect
            ['djangoAuthToken', 'authToken', 'firebaseIdToken',
             'pageUser', 'user', 'userId', 'authSource'].forEach(k => localStorage.removeItem(k));
            pfToast('Account deleted. Goodbye!');
            setTimeout(() => { window.location.replace('/pages/auth.html'); }, 1500);
            return;
        }

        const data = await res.json().catch(() => ({}));
        const el = document.getElementById('pfDeleteError');
        el.textContent = data.detail || data.error || 'Deletion failed. Please try again.';
        el.style.display = 'block';
    } catch (e) {
        console.error(e);
        const el = document.getElementById('pfDeleteError');
        el.textContent = 'Network error. Please try again.';
        el.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash-alt"></i> Delete My Account';
    }
}

/* ═══════════════════════════════════════════════════════════════
   ACTIVITY FEED
═══════════════════════════════════════════════════════════════ */
async function pfLoadActivities() {
    try {
        const res = await fetch(`${PF_API}/auth/activities/?limit=100`, { headers: pfHeaders() });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        _pfAllActs = (data.results || data);
        pfSet('pfActCount', _pfAllActs.length > 99 ? '99+' : _pfAllActs.length || '');
        pfRenderActivityItems(pfFilteredActs());
        const lm = document.getElementById('pfLoadMore');
        if (lm) lm.style.display = _pfAllActs.length > PF_PAGE_SIZE ? 'flex' : 'none';
    } catch {
        const list = document.getElementById('pfActList');
        if (list) list.innerHTML = '<div class="pf-empty"><i class="fas fa-triangle-exclamation"></i><span>Could not load activity</span></div>';
    }
}

function pfFilteredActs() {
    if (_pfCurrentFilter === 'all') return _pfAllActs;
    const types = PF_ACT_FILTER_TYPES[_pfCurrentFilter] || [];
    return _pfAllActs.filter(a => types.includes(a.activity_type));
}

function pfRenderActivityItems(items) {
    const list = document.getElementById('pfActList');
    if (!list) return;

    const slice = items.slice(0, _pfActShown);
    if (!slice.length) {
        list.innerHTML = '<div class="pf-empty"><i class="fas fa-bolt-lightning"></i><span>No activity in this category</span></div>';
        return;
    }

    list.innerHTML = slice.map((a, i) => {
        const m = PF_ACT_META[a.activity_type] || { icon: 'fa-circle', bg: 'linear-gradient(135deg,#6b7280,#9ca3af)' };
        return `<div class="pf-act-item" style="animation-delay:${i * 0.04}s">
            <div class="pf-act-icon" style="background:${m.bg}"><i class="fas ${m.icon}"></i></div>
            <div class="pf-act-body">
                <div class="pf-act-desc">${pfEsc(a.description || '')}</div>
                <div class="pf-act-time">${pfTimeAgo(a.created_at)}</div>
            </div>
            ${a.points_change ? `<span class="pf-act-pts">+${a.points_change}</span>` : ''}
        </div>`;
    }).join('');

    const lm = document.getElementById('pfLoadMore');
    if (lm) lm.style.display = items.length > _pfActShown ? 'flex' : 'none';
}

function pfLoadMoreActivity() {
    _pfActShown += PF_PAGE_SIZE;
    pfRenderActivityItems(pfFilteredActs());
}

/* ═══════════════════════════════════════════════════════════════
   FOLLOWERS / FOLLOWING MODAL
═══════════════════════════════════════════════════════════════ */
function pfOpenFollowers(tab) {
    pfOpenModal('pfFollowModal');
    pfSwitchFollowTab(tab);
}
function pfCloseFollowers() { pfCloseModal('pfFollowModal'); }

async function pfSwitchFollowTab(tab) {
    _pfFollowTab = tab;
    document.querySelectorAll('.pf-follow-tab').forEach(b => b.classList.remove('active'));
    const active = document.getElementById(tab === 'followers' ? 'pfFolTabFollowers' : 'pfFolTabFollowing');
    if (active) active.classList.add('active');
    await pfLoadFollowList(tab);
}

async function pfLoadFollowList(tab) {
    const list = document.getElementById('pfFollowList');
    if (!list) return;
    list.innerHTML = '<div class="pf-skeleton-row"></div><div class="pf-skeleton-row short"></div><div class="pf-skeleton-row"></div>';

    const uid = _pfViewId || _pfData?.id;
    const qp  = uid ? `?user_id=${encodeURIComponent(uid)}` : '';
    const endpoint = tab === 'followers'
        ? `${PF_API}/social/follows/followers/${qp}`
        : `${PF_API}/social/follows/following/${qp}`;

    try {
        let users = [];
        const res = await fetch(endpoint, { headers: pfHeaders() });
        if (res.ok) {
            const data = await res.json();
            const rows = Array.isArray(data) ? data : (data.results || data.followers || data.following || []);
            users = rows.map(r => r?.user || r).filter(Boolean);
        }

        if (!users.length) {
            list.innerHTML = `<div class="pf-empty"><i class="fas fa-users"></i><span>No ${tab} yet</span></div>`;
            return;
        }

        list.innerHTML = users.map(u => {
            const name  = u.display_name || u.username || 'User';
            const handle = u.username || '';
            const tier   = u.access_tier || 'Bronze';
            const av = u.profile_image_url || u.profile_image || null;
            const avUrl = av ? ((typeof resolveMediaUrl === 'function') ? resolveMediaUrl(av) : av) : null;
            const init = (name || '?').charAt(0).toUpperCase();
            const avHTML = avUrl
                ? `<img src="${pfEsc(avUrl)}" alt="${pfEsc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.replaceWith(window.pageLetterAvatar?window.pageLetterAvatar('${pfEsc(init)}'):this)">`
                : (window.pageLetterAvatarHTML ? window.pageLetterAvatarHTML(init)
                    : `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--page-primary,#374151);color:#fff;font-weight:700;font-size:14px;">${init}</span>`);

            return `<div class="pf-follow-row" onclick="window.location.href='profile.html?id=${u.id}'">
                <div class="pf-follow-av">${avHTML}</div>
                <div class="pf-follow-info">
                    <span class="pf-follow-name">${pfEsc(name)}</span>
                    <span class="pf-follow-handle">@${pfEsc(handle)}</span>
                </div>
                <span class="pf-follow-tier">${pfEsc(tier)}</span>
            </div>`;
        }).join('');
    } catch {
        list.innerHTML = '<div class="pf-empty"><i class="fas fa-triangle-exclamation"></i><span>Could not load list</span></div>';
    }
}

/* ═══════════════════════════════════════════════════════════════
   TIER PALETTE  (cover gradient + avatar ring)
═══════════════════════════════════════════════════════════════ */
const PF_TIER_COLORS = {
    Bronze:    ['#92400e','#d97706'],
    Silver:    ['#475569','#94a3b8'],
    Gold:      ['#78350f','#f59e0b'],
    Platinum:  ['#1e3a5f','#60a5fa'],
    Diamond:   ['#0c4a6e','#22d3ee'],
    Elite:     ['#4c1d95','#a78bfa'],
    Legendary: ['#4c1d95','#7c3aed'],
};

function pfApplyTierPalette(tier) {
    const c = PF_TIER_COLORS[tier] || PF_TIER_COLORS.Bronze;
    const cover = document.getElementById('pfCover');
    if (cover) {
        cover.style.background = `linear-gradient(135deg, ${c[0]} 0%, var(--page-primary-dk,#1f2937) 50%, ${c[1]}55 100%)`;
    }
    const ring = document.getElementById('pfAvRing');
    if (ring) {
        ring.style.background = `conic-gradient(${c[0]}, ${c[1]}, var(--page-accent,#fff), ${c[0]})`;
    }
}

// Expose so other pages can call it
window.applyTierPalette = pfApplyTierPalette;

/* ═══════════════════════════════════════════════════════════════
   DONUT CHART
═══════════════════════════════════════════════════════════════ */
function pfBuildDonut(u) {
    const circ  = 2 * Math.PI * 52;
    const total = u.total_submissions || 0;
    const ok    = u.successful_submissions || 0;
    const wrong = total - ok;
    const cFrac = total > 0 ? ok    / total : 0;
    const wFrac = total > 0 ? wrong / total : 0;
    const dc = document.getElementById('pfDCorrect');
    const dw = document.getElementById('pfDWrong');
    if (!dc || !dw) return;
    dc.style.strokeDasharray  = `${cFrac * circ} ${circ}`;
    dc.style.strokeDashoffset = String(circ * 0.25);
    dw.style.strokeDasharray  = `${wFrac * circ} ${circ}`;
    dw.style.strokeDashoffset = String(circ * 0.25 - cFrac * circ);
}

/* ═══════════════════════════════════════════════════════════════
   MODAL HELPERS
═══════════════════════════════════════════════════════════════ */
function pfOpenModal(id)  { const el = document.getElementById(id); if (el) el.classList.add('open'); }
function pfCloseModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('open'); }

function pfBgClose(event, id) {
    if (event.target === document.getElementById(id)) pfCloseModal(id);
}

/* ═══════════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════════ */
function pfToast(msg, _type = 'info') {
    const t = document.getElementById('pfToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(pfToast._timer);
    pfToast._timer = setTimeout(() => t.classList.remove('show'), 3200);
}
window.showToast = pfToast; // compatibility alias

/* ═══════════════════════════════════════════════════════════════
   DOM HELPERS
═══════════════════════════════════════════════════════════════ */
function pfSet(id, val)       { const el = document.getElementById(id); if (el) el.textContent = val; }
function pfSetHTML(id, html)  { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function pfShow(id)           { const el = document.getElementById(id); if (el) el.style.display = ''; }
function pfSetWidth(id, pct)  { const el = document.getElementById(id); if (el) el.style.width = `${pct}%`; }

function pfTimeAgo(d) {
    const diff = Date.now() - new Date(d).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
    if (diff < 604800000)return `${Math.floor(diff/86400000)}d ago`;
    return new Date(d).toLocaleDateString();
}

function pfEsc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ═══════════════════════════════════════════════════════════════
   GLOBAL EXPORTS (called from HTML onclick attributes)
═══════════════════════════════════════════════════════════════ */
window.pfOpenEdit          = pfOpenEdit;
window.pfCloseEdit         = pfCloseEdit;
window.pfSaveProfile       = pfSaveProfile;
window.pfUploadAvatar      = pfUploadAvatar;
window.pfUploadCover       = pfUploadCover;
window.pfToggleFollow      = pfToggleFollow;
window.pfOpenFollowers     = pfOpenFollowers;
window.pfCloseFollowers    = pfCloseFollowers;
window.pfSwitchFollowTab   = pfSwitchFollowTab;
window.pfConfirmDeleteAccount = pfConfirmDeleteAccount;
window.pfCloseDelete       = pfCloseDelete;
window.pfCheckDeleteConfirm = pfCheckDeleteConfirm;
window.pfDeleteAccount     = pfDeleteAccount;
window.pfBgClose           = pfBgClose;
window.pfLoadMoreActivity  = pfLoadMoreActivity;
