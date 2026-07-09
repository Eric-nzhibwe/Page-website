// ─────────────────────────────────────────────────────────────────────────────
// ARTX Settings — Complete Implementation
// ─────────────────────────────────────────────────────────────────────────────

const _SM_API = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _smToken() {
    return localStorage.getItem('djangoAuthToken') || '';
}

function _smGetUser() {
    if (typeof currentUser !== 'undefined' && currentUser) return currentUser;
    try { return JSON.parse(localStorage.getItem('artxUser') || '{}'); } catch { return {}; }
}

function _smHeaders(multipart) {
    const h = { 'Authorization': `Token ${_smToken()}` };
    if (!multipart) h['Content-Type'] = 'application/json';
    return h;
}

/** Set value of an input / textarea by element ID */
function _smVal(id, val) {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
}

/** Set selected option of a <select> by element ID */
function _smSel(id, val) {
    const el = document.getElementById(id);
    if (el && val != null) el.value = val;
}

/** Set checkbox checked state by element ID */
function _smChk(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

/** Read checkbox state */
function _smGetChk(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
}

/** Read select value */
function _smGetSel(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
}

/** Read input value */
function _smGetVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// ── Toast ─────────────────────────────────────────────────────────────────────

let _smToastTimer = null;

function showToast(msg, type = 'success') {
    // type: 'success' | 'error' | 'info' | 'warning'
    let toast = document.getElementById('smToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'smToast';
        toast.className = 'artx-toast';
        toast.innerHTML = `<i></i><span></span><button class="sm-toast-close" onclick="this.parentElement.classList.remove('visible')">×</button>`;
        document.body.appendChild(toast);
    }

    const icons = { success: 'fas fa-circle-check', error: 'fas fa-circle-xmark', info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation' };
    toast.querySelector('i').className = icons[type] || icons.info;
    toast.querySelector('span').textContent = msg;
    toast.className = `artx-toast artx-toast-${type}`;

    // force reflow then show
    toast.offsetHeight;
    toast.classList.add('visible');

    clearTimeout(_smToastTimer);
    _smToastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

// ── Open / Close ──────────────────────────────────────────────────────────────

function showSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadUserSettings();
    loadLinkedAccounts();
    loadActiveSessions();
    showSettingsTab('account');
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.classList.add('closing');
    setTimeout(() => {
        modal.style.display = 'none';
        modal.classList.remove('closing');
        document.body.style.overflow = '';
    }, 250);
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('settingsModal');
    if (e.target === modal) closeSettings();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('settingsModal');
        if (modal && modal.style.display === 'flex') closeSettings();
    }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function showSettingsTab(name) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));

    const tab = document.getElementById(name + 'Tab');
    if (tab) tab.classList.add('active');

    const btn = document.querySelector(`.settings-nav-btn[data-tab="${name}"]`);
    if (btn) btn.classList.add('active');
}

// ── Load user data ────────────────────────────────────────────────────────────

function loadUserSettings() {
    const user  = _smGetUser();
    const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    const p     = Object.assign({}, prefs, user.preferences || {});

    // Account tab
    _smVal('settingsUsername', user.username);
    _smVal('settingsEmail',    user.email);
    _smVal('settingsPhone',    user.phone);
    _smVal('settingsDOB',      user.date_of_birth);

    // Profile tab
    _smVal('settingsDisplayName', user.display_name || user.username);
    _smVal('settingsBio',         user.bio);
    _smVal('settingsLocation',    user.location);
    _smVal('settingsWebsite',     user.website);

    // Avatar preview
    const avPrev = document.getElementById('settingsAvatarPreview');
    if (avPrev) {
        if (user.profile_image) {
            avPrev.innerHTML = `<img src="${user.profile_image}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        } else {
            avPrev.innerHTML = '<i class="fas fa-user-circle"></i>';
        }
    }
    const avName = document.getElementById('settingsAvatarName');
    if (avName) avName.textContent = user.display_name || user.username || 'Player';

    // Privacy tab
    _smSel('profileVisibility', p.profileVisibility || 'public');
    _smSel('messagePrivacy',    p.messagePrivacy    || 'everyone');
    _smChk('showOnlineStatus',  p.showOnlineStatus  !== false);
    _smChk('showActivity',      p.showActivity      !== false);
    _smChk('showStats',         p.showStats         !== false);

    // Notifications tab
    _smChk('pushNotifications',      p.pushNotifications      !== false);
    _smChk('emailNotifications',     p.emailNotifications     !== false);
    _smChk('soundEffects',           p.soundEffects           !== false);
    _smChk('challengeNotifications', p.challengeNotifications !== false);
    _smChk('messageNotifications',   p.messageNotifications   !== false);
    _smChk('allianceNotifications',  p.allianceNotifications  !== false);
    _smChk('tournamentNotifications',p.tournamentNotifications !== false);

    // Appearance tab
    _smSel('themeSelect', p.theme    || 'dark');
    _smSel('fontSize',    p.fontSize || 'medium');
    _smChk('enableAnimations', p.enableAnimations !== false);
    _smChk('compactMode',      p.compactMode === true);

    if (p.accentColor) {
        document.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === p.accentColor);
        });
        _applyAccentVars(p.accentColor);
    }

    // Inject accent name label below swatches if not already there
    const grid = document.querySelector('.color-picker-grid');
    if (grid && !document.getElementById('smAccentLabel')) {
        const lbl = document.createElement('span');
        lbl.id = 'smAccentLabel';
        lbl.className = 'sm-accent-label';
        lbl.style.opacity = '0';
        grid.parentElement.appendChild(lbl);
    }

    // Security tab
    _smChk('enable2FA', user.two_factor_enabled === true || user.twoFactorEnabled === true);
}

// ── Save Account Settings ─────────────────────────────────────────────────────

async function saveAccountSettings() {
    const btn = document.querySelector('#accountTab .btn-settings-save');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const payload = {
        username:      _smGetVal('settingsUsername'),
        email:         _smGetVal('settingsEmail'),
        phone:         _smGetVal('settingsPhone'),
        date_of_birth: _smGetVal('settingsDOB') || null,
    };

    try {
        const res = await fetch(`${_SM_API}/auth/profile/`, {
            method:  'PATCH',
            headers: _smHeaders(),
            body:    JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.username?.[0] || data.email?.[0] || 'Save failed');

        // Sync global currentUser
        if (typeof currentUser !== 'undefined' && currentUser) Object.assign(currentUser, data);
        showToast('Account settings saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Save Profile Settings ─────────────────────────────────────────────────────

async function saveProfileSettings() {
    const btn = document.querySelector('#profileTab .btn-settings-save');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const payload = {
        display_name: _smGetVal('settingsDisplayName'),
        bio:          _smGetVal('settingsBio'),
        location:     _smGetVal('settingsLocation'),
        website:      _smGetVal('settingsWebsite'),
    };

    try {
        const res = await fetch(`${_SM_API}/auth/profile/`, {
            method:  'PATCH',
            headers: _smHeaders(),
            body:    JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Save failed');

        if (typeof currentUser !== 'undefined' && currentUser) Object.assign(currentUser, data);

        // Refresh visible profile name / bio if on user page
        const dnEl = document.getElementById('profileDisplayName');
        if (dnEl && data.display_name) dnEl.textContent = data.display_name;
        const bioEl = document.getElementById('heroBio') || document.getElementById('profileBio');
        if (bioEl && data.bio != null) bioEl.textContent = data.bio;

        showToast('Profile saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Save Privacy Settings ─────────────────────────────────────────────────────

async function savePrivacySettings() {
    const btn = document.querySelector('#privacyTab .btn-settings-save');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const prefs = _smLoadPrefs();
    prefs.profileVisibility = _smGetSel('profileVisibility');
    prefs.messagePrivacy    = _smGetSel('messagePrivacy');
    prefs.showOnlineStatus  = _smGetChk('showOnlineStatus');
    prefs.showActivity      = _smGetChk('showActivity');
    prefs.showStats         = _smGetChk('showStats');

    try {
        await _smSavePrefs(prefs);
        showToast('Privacy settings saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Save Notification Settings ────────────────────────────────────────────────

async function saveNotificationSettings() {
    const btn = document.querySelector('#notificationsTab .btn-settings-save');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const prefs = _smLoadPrefs();
    prefs.pushNotifications      = _smGetChk('pushNotifications');
    prefs.emailNotifications     = _smGetChk('emailNotifications');
    prefs.soundEffects           = _smGetChk('soundEffects');
    prefs.challengeNotifications = _smGetChk('challengeNotifications');
    prefs.messageNotifications   = _smGetChk('messageNotifications');
    prefs.allianceNotifications  = _smGetChk('allianceNotifications');
    prefs.tournamentNotifications= _smGetChk('tournamentNotifications');

    try {
        await _smSavePrefs(prefs);
        showToast('Notification preferences saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Save Appearance Settings ──────────────────────────────────────────────────

async function saveAppearanceSettings() {
    const btn = document.querySelector('#appearanceTab .btn-settings-save');
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    const prefs = _smLoadPrefs();
    prefs.theme            = _smGetSel('themeSelect');
    prefs.fontSize         = _smGetSel('fontSize');
    prefs.enableAnimations = _smGetChk('enableAnimations');
    prefs.compactMode      = _smGetChk('compactMode');

    const activeSwatch = document.querySelector('.color-swatch.active');
    if (activeSwatch) prefs.accentColor = activeSwatch.dataset.color;

    try {
        await _smSavePrefs(prefs);
        _applyAppearance(prefs);
        showToast('Appearance saved', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Preferences helpers ───────────────────────────────────────────────────────

function _smLoadPrefs() {
    try { return JSON.parse(localStorage.getItem('userPreferences') || '{}'); } catch { return {}; }
}

async function _smSavePrefs(prefs) {
    localStorage.setItem('userPreferences', JSON.stringify(prefs));
    const res = await fetch(`${_SM_API}/auth/preferences/`, {
        method:  'PATCH',
        headers: _smHeaders(),
        body:    JSON.stringify(prefs),
    });
    if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || 'Failed to save preferences');
    }
}

// ── Appearance live helpers ───────────────────────────────────────────────────

function changeTheme() {
    const theme = _smGetSel('themeSelect');
    document.documentElement.setAttribute('data-theme', theme);
}

function changeFontSize() {
    const size = _smGetSel('fontSize');
    const map  = { small: '13px', medium: '15px', large: '17px' };
    document.documentElement.style.fontSize = map[size] || '15px';
}

// ── Accent color palette ──────────────────────────────────────────────────────
// Each entry: { hex, name, primary (darker), primaryLt, glow }
const ACCENT_PALETTES = {
    '#90ee90': { name: 'Green',  primary: '#556b2f', primaryLt: '#6b8a3a', primaryDk: '#3d4f22', glow: 'rgba(85,107,47,0.18)' },
    '#4facfe': { name: 'Blue',   primary: '#1565c0', primaryLt: '#1e88e5', primaryDk: '#0d47a1', glow: 'rgba(21,101,192,0.18)' },
    '#f093fb': { name: 'Pink',   primary: '#8e24aa', primaryLt: '#ab47bc', primaryDk: '#6a1b9a', glow: 'rgba(142,36,170,0.18)' },
    '#ffd700': { name: 'Gold',   primary: '#b8860b', primaryLt: '#d4a017', primaryDk: '#8b6508', glow: 'rgba(184,134,11,0.18)'  },
    '#ff6b6b': { name: 'Red',    primary: '#c62828', primaryLt: '#e53935', primaryDk: '#8e0000', glow: 'rgba(198,40,40,0.18)'   },
    '#a78bfa': { name: 'Purple', primary: '#4527a0', primaryLt: '#5e35b1', primaryDk: '#311b92', glow: 'rgba(69,39,160,0.18)'   },
};

function selectAccentColor(color) {
    // Update active swatch
    document.querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('active', s.dataset.color === color);
    });

    _applyAccentVars(color);
    _spawnColorRipple(color);

    // Show a subtle label under the swatches
    const palette = ACCENT_PALETTES[color];
    const labelEl = document.getElementById('smAccentLabel');
    if (labelEl && palette) {
        labelEl.textContent = palette.name;
        labelEl.style.color = palette.primary;
        labelEl.style.opacity = '1';
        clearTimeout(labelEl._t);
        labelEl._t = setTimeout(() => { labelEl.style.opacity = '0'; }, 1800);
    }
}

function _applyAccentVars(color) {
    const palette = ACCENT_PALETTES[color] || ACCENT_PALETTES['#90ee90'];
    const root = document.documentElement;

    // Settings modal variables
    root.style.setProperty('--sg-primary',     palette.primary);
    root.style.setProperty('--sg-primary-lt',  palette.primaryLt);
    root.style.setProperty('--sg-primary-dk',  palette.primaryDk);
    root.style.setProperty('--sg-accent',      color);
    root.style.setProperty('--sg-glow',        `0 0 0 3px ${palette.glow}`);

    // Global site variables (picks up hardcoded darkolivegreen via CSS override layer)
    root.style.setProperty('--artx-primary',   palette.primary);
    root.style.setProperty('--artx-primary-lt',palette.primaryLt);
    root.style.setProperty('--artx-accent',    color);
    root.style.setProperty('--artx-glow',      palette.glow);

    // Transition all color changes smoothly
    root.style.setProperty('--color-transition', 'color 0.35s ease, background-color 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease');
}

function _spawnColorRipple(color) {
    // Find the active swatch to spawn ripple from
    const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
    if (!swatch) return;

    const ripple = document.createElement('span');
    ripple.className = 'sm-color-ripple';
    ripple.style.cssText = `background:${color};`;
    swatch.appendChild(ripple);

    // Force reflow
    ripple.offsetWidth;
    ripple.classList.add('expanding');
    setTimeout(() => ripple.remove(), 600);
}

function _applyAppearance(prefs) {
    if (prefs.theme) document.documentElement.setAttribute('data-theme', prefs.theme);
    if (prefs.fontSize) {
        const map = { small: '13px', medium: '15px', large: '17px' };
        document.documentElement.style.fontSize = map[prefs.fontSize] || '15px';
    }
    if (prefs.accentColor) {
        _applyAccentVars(prefs.accentColor);
        // Sync active swatch on load
        document.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === prefs.accentColor);
        });
    }
    document.documentElement.classList.toggle('no-animations', !prefs.enableAnimations);
    document.documentElement.classList.toggle('compact-mode',   !!prefs.compactMode);
}

// ── Change Password ───────────────────────────────────────────────────────────

async function changePassword() {
    const btn = document.querySelector('#securityTab .btn-settings-save');
    const current = _smGetVal('currentPassword');
    const newPw   = _smGetVal('newPassword');
    const confirm = _smGetVal('confirmPassword');

    if (!current || !newPw || !confirm) {
        showToast('Please fill in all password fields', 'warning'); return;
    }
    if (newPw !== confirm) {
        showToast('New passwords do not match', 'error'); return;
    }
    if (newPw.length < 8) {
        showToast('Password must be at least 8 characters', 'error'); return;
    }

    if (btn) { btn.classList.add('loading'); btn.disabled = true; }

    try {
        const res = await fetch(`${_SM_API}/auth/change-password/`, {
            method:  'POST',
            headers: _smHeaders(),
            body:    JSON.stringify({ current_password: current, new_password: newPw }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || data.current_password?.[0] || data.new_password?.[0] || 'Password change failed');

        // Clear fields
        _smVal('currentPassword', ''); _smVal('newPassword', ''); _smVal('confirmPassword', '');
        const strengthEl = document.getElementById('passwordStrength');
        if (strengthEl) strengthEl.style.display = 'none';
        showToast('Password updated successfully', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
    }
}

// ── Password strength meter ───────────────────────────────────────────────────

function checkPasswordStrength(val) {
    const wrap  = document.getElementById('passwordStrength');
    const fill  = document.getElementById('strengthFill');
    const label = document.getElementById('strengthLabel');
    if (!wrap) return;

    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';

    let score = 0;
    if (val.length >= 8)  score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;

    const levels = [
        { pct: '20%', color: '#e53935', text: 'Weak' },
        { pct: '40%', color: '#fb8c00', text: 'Fair' },
        { pct: '60%', color: '#fdd835', text: 'Good' },
        { pct: '80%', color: '#7cb342', text: 'Strong' },
        { pct: '100%',color: '#43a047', text: 'Excellent' },
    ];
    const lvl = levels[Math.min(score, levels.length) - 1] || levels[0];
    if (fill) { fill.style.width = lvl.pct; fill.style.background = lvl.color; }
    if (label) { label.textContent = lvl.text; label.style.color = lvl.color; }
}

// ── Toggle password visibility ────────────────────────────────────────────────

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const icon = btn.querySelector('i');
    if (icon) { icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye'; }
}

// ── 2FA ───────────────────────────────────────────────────────────────────────

async function setup2FA() {
    showToast('Authenticator setup coming soon', 'info');
}

// ── Sessions ──────────────────────────────────────────────────────────────────

async function loadActiveSessions() {
    const list = document.getElementById('sessionsList');
    if (!list) return;
    list.innerHTML = '<div class="sessions-loading"><i class="fas fa-spinner fa-spin"></i> Loading sessions...</div>';

    try {
        const res  = await fetch(`${_SM_API}/auth/sessions/`, { headers: _smHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to load sessions');

        const sessions = Array.isArray(data) ? data : (data.sessions || data.results || []);
        if (!sessions.length) {
            list.innerHTML = '<p class="sessions-loading">No active sessions found.</p>'; return;
        }

        list.innerHTML = sessions.map(s => `
            <div class="session-item ${s.is_current ? 'current-session' : ''}">
                <span class="session-device"><i class="fas fa-${_smDeviceIcon(s.device_type || s.device || '')}"></i> ${s.device_name || s.device || 'Unknown device'}</span>
                <span class="session-meta">${s.location || ''} · ${s.last_active || s.created || ''}</span>
                ${s.is_current ? '<span class="session-badge">Current</span>' : ''}
            </div>`).join('');
    } catch {
        list.innerHTML = '<p class="sessions-loading">Could not load sessions.</p>';
    }
}

function _smDeviceIcon(type) {
    if (/mobile|phone|android|ios/i.test(type)) return 'mobile-alt';
    if (/tablet/i.test(type)) return 'tablet-alt';
    return 'desktop';
}

async function logoutAllDevices() {
    if (!confirm('This will log you out of all other devices. Continue?')) return;
    try {
        const res  = await fetch(`${_SM_API}/auth/logout-all/`, { method: 'POST', headers: _smHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Failed');
        showToast('Logged out of all other devices', 'success');
        loadActiveSessions();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Linked Accounts ───────────────────────────────────────────────────────────

async function loadLinkedAccounts() {
    const user = _smGetUser();
    const socials = user.social_connections || user.social_accounts || {};

    const platforms = ['twitter', 'instagram', 'youtube', 'tiktok', 'facebook'];
    platforms.forEach(p => {
        const handle  = socials[p] || null;
        const handleEl = document.getElementById(`lpHandle${_cap(p)}`);
        const btnEl    = document.getElementById(`lpBtn${_cap(p)}`);
        const rowEl    = document.querySelector(`.linked-platform-row[data-platform="${p}"]`);

        if (handleEl) {
            handleEl.textContent = handle ? `@${handle}` : 'Not connected';
            handleEl.style.color  = handle ? 'var(--color-primary, #556b2f)' : '';
        }
        if (btnEl) {
            btnEl.textContent  = handle ? 'Disconnect' : 'Connect';
            btnEl.className    = handle ? 'lp-btn disconnect' : 'lp-btn';
        }
        if (rowEl) rowEl.classList.toggle('connected', !!handle);
    });
}

function _cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

async function toggleSocialLink(platform) {
    const handleEl = document.getElementById(`lpHandle${_cap(platform)}`);
    const btnEl    = document.getElementById(`lpBtn${_cap(platform)}`);
    const isConnected = btnEl && btnEl.classList.contains('disconnect');

    if (isConnected) {
        if (!confirm(`Disconnect your ${platform} account?`)) return;
        if (btnEl) { btnEl.textContent = '...'; btnEl.disabled = true; }
        try {
            const res  = await fetch(`${_SM_API}/auth/social/disconnect/${platform}/`, { method: 'DELETE', headers: _smHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Failed to disconnect');
            if (handleEl) { handleEl.textContent = 'Not connected'; handleEl.style.color = ''; }
            if (btnEl)    { btnEl.textContent = 'Connect'; btnEl.className = 'lp-btn'; }
            const rowEl = document.querySelector(`.linked-platform-row[data-platform="${platform}"]`);
            if (rowEl) rowEl.classList.remove('connected');

            // Sync user object
            const user = _smGetUser();
            if (user.social_connections) delete user.social_connections[platform];
            if (typeof currentUser !== 'undefined' && currentUser && currentUser.social_connections)
                delete currentUser.social_connections[platform];

            showToast(`${_cap(platform)} disconnected`, 'success');
        } catch (err) {
            showToast(err.message, 'error');
            if (btnEl) { btnEl.textContent = 'Disconnect'; btnEl.disabled = false; }
        }
    } else {
        // Connect — prompt for handle
        const handle = prompt(`Enter your ${_cap(platform)} username (without @):`);
        if (!handle || !handle.trim()) return;
        if (btnEl) { btnEl.textContent = '...'; btnEl.disabled = true; }
        try {
            const res  = await fetch(`${_SM_API}/auth/social/connect/`, {
                method:  'POST',
                headers: _smHeaders(),
                body:    JSON.stringify({ platform, handle: handle.trim() }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Failed to connect');
            if (handleEl) { handleEl.textContent = `@${handle.trim()}`; handleEl.style.color = 'var(--color-primary, #556b2f)'; }
            if (btnEl)    { btnEl.textContent = 'Disconnect'; btnEl.className = 'lp-btn disconnect'; btnEl.disabled = false; }
            const rowEl = document.querySelector(`.linked-platform-row[data-platform="${platform}"]`);
            if (rowEl) rowEl.classList.add('connected');

            if (typeof currentUser !== 'undefined' && currentUser) {
                if (!currentUser.social_connections) currentUser.social_connections = {};
                currentUser.social_connections[platform] = handle.trim();
            }

            showToast(`${_cap(platform)} connected`, 'success');
        } catch (err) {
            showToast(err.message, 'error');
            if (btnEl) { btnEl.textContent = 'Connect'; btnEl.disabled = false; }
        }
    }
}

// ── Avatar upload ─────────────────────────────────────────────────────────────

function changeAvatar() {
    let input = document.getElementById('smAvatarInput');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id   = 'smAvatarInput';
        input.accept = 'image/jpeg,image/png,image/gif,image/webp';
        input.style.display = 'none';
        document.body.appendChild(input);
    }
    input.onchange = _smUploadAvatar;
    input.click();
}

async function _smUploadAvatar(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('File must be under 5 MB', 'error'); return; }

    const form = new FormData();
    form.append('avatar', file);

    showToast('Uploading…', 'info');
    try {
        const res  = await fetch(`${_SM_API}/auth/avatar/`, {
            method:  'POST',
            headers: { 'Authorization': `Token ${_smToken()}` }, // no Content-Type — let browser set multipart
            body:    form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Upload failed');

        const imgUrl = data.profile_image || data.avatar_url || data.url;
        if (imgUrl) {
            const prev = document.getElementById('settingsAvatarPreview');
            if (prev) prev.innerHTML = `<img src="${imgUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;

            // Also update profile page avatar if present
            const av = document.getElementById('avatarDisplay') || document.getElementById('smAvatarImg');
            if (av) { av.innerHTML = `<img src="${imgUrl}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`; }

            if (typeof currentUser !== 'undefined' && currentUser) currentUser.profile_image = imgUrl;
        }
        showToast('Profile photo updated', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
    // reset so same file can be re-selected
    e.target.value = '';
}

// ── Danger zone ───────────────────────────────────────────────────────────────

async function deactivateAccount() {
    const confirmed = confirm(
        'Deactivate your account?\n\nYour profile will be hidden and you won\'t be able to log in until you reactivate it.'
    );
    if (!confirmed) return;

    try {
        const res  = await fetch(`${_SM_API}/auth/deactivate/`, { method: 'POST', headers: _smHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'Deactivation failed');
        showToast('Account deactivated. Logging out…', 'info');
        setTimeout(() => {
            localStorage.removeItem('djangoAuthToken');
            window.location.href = '../pages/auth.html';
        }, 2000);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteAccount() {
    const first  = confirm('⚠️ Delete your ARTX account?\n\nThis is PERMANENT — all your data, prestige, and earnings will be lost.');
    if (!first) return;
    const second = prompt('Type DELETE to confirm account deletion:');
    if (second !== 'DELETE') { showToast('Deletion cancelled', 'info'); return; }

    try {
        const res  = await fetch(`${_SM_API}/auth/delete-account/`, { method: 'DELETE', headers: _smHeaders() });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.detail || 'Deletion failed');
        }
        showToast('Account deleted. Goodbye.', 'info');
        setTimeout(() => {
            localStorage.clear();
            window.location.href = '../pages/auth.html';
        }, 2000);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Boot: apply saved appearance on page load ─────────────────────────────────

(function _smBoot() {
    try {
        const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
        _applyAppearance(prefs);
    } catch { /* silent */ }
})();
