// ─────────────────────────────────────────────────────────────────────────────
// Settings — ARTX Platform
// ─────────────────────────────────────────────────────────────────────────────

// ── Open / Close ──────────────────────────────────────────────────────────────

function showSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadUserSettings();
    loadLinkedAccounts();
    loadActiveSessions();
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

// Close when clicking the backdrop
window.addEventListener('click', (e) => {
    const modal = document.getElementById('settingsModal');
    if (e.target === modal) closeSettings();
});

// Close on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = document.getElementById('settingsModal');
        if (modal && modal.style.display === 'flex') closeSettings();
    }
});

// ── Tab switching ─────────────────────────────────────────────────────────────

function showSettingsTab(tabName) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.remove('active'));

    const tab = document.getElementById(tabName + 'Tab');
    if (tab) tab.classList.add('active');

    // Mark the nav button whose data-tab matches
    const btn = document.querySelector(`.settings-nav-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
}

// ── Load user data into fields ────────────────────────────────────────────────

function loadUserSettings() {
    const user  = getStoredUser();
    const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');

    // Merge server-side preferences if present on the user object
    const merged = Object.assign({}, prefs, user.preferences || {});

    // ── Account
    setValue('settingsUsername', user.username);
    setValue('settingsEmail', user.email);
    setValue('settingsPhone', user.phone);
    setValue('settingsDOB', user.date_of_birth);

    // ── Profile
    setValue('settingsDisplayName', user.display_name || user.username);
    setValue('settingsBio', user.bio);
    setValue('settingsLocation', user.location);
    setValue('settingsWebsite', user.website);

    // Show avatar if available
    const avatarPreview = document.getElementById('settingsAvatarPreview');
    if (avatarPreview && user.profile_image) {
        avatarPreview.innerHTML = `<img src="${user.profile_image}" alt="Avatar">`;
    }
    const avatarName = document.getElementById('settingsAvatarName');
    if (avatarName) avatarName.textContent = user.display_name || user.username || 'Player';

    // ── Privacy
    setSelect('profileVisibility', merged.profileVisibility || 'public');
    setSelect('messagePrivacy',    merged.messagePrivacy    || 'everyone');
    setChecked('showOnlineStatus', merged.showOnlineStatus  !== false);
    setChecked('showActivity',     merged.showActivity      !== false);
    setChecked('showStats',        merged.showStats         !== false);

    // ── Notifications
    setChecked('pushNotifications',      merged.pushNotifications      !== false);
    setChecked('emailNotifications',     merged.emailNotifications     !== false);
    setChecked('challengeNotifications', merged.challengeNotifications !== false);
    setChecked('messageNotifications',   merged.messageNotifications   !== false);
    setChecked('allianceNotifications',  merged.allianceNotifications  !== false);
    setChecked('tournamentNotifications',merged.tournamentNotifications !== false);
    setChecked('soundEffects',           merged.soundEffects           !== false);

    // ── Appearance
    setSelect('themeSelect', merged.theme    || 'dark');
    setSelect('fontSize',    merged.fontSize || 'medium');
    setChecked('enableAnimations', merged.enableAnimations !== false);
    setChecked('compactMode',      merged.compactMode      === true);

    // Mark the saved accent colour
    if (merged.accentColor) {
        document.querySelectorAll('.color-swatch').forEach(s => {
            s.classList.toggle('active', s.dataset.color === merged.accentColor);
        });
    }

    // ── Security
    setChecked('enable2FA', user.twoFactorEnabled === true);
}

// small helpers
function setValue(id, val)    { const el = document.getElementById(id); if (el && val != null) el.value = val; }
function setSelect(id, val)   { setValue(id, val); }
function setChecked(id, bool) { const el = document.getElementById(id); if (el) el.checked = !!bool; }

// ── Account ───────────────────────────────────────────────────────────────────

async function saveAccountSettings() {
    const btn = event.currentTarget;
    setLoading(btn, true);

    const payload = {
        username:       getVal('settingsUsername'),
        email:          getVal('settingsEmail'),
        phone:          getVal('settingsPhone'),
        date_of_birth:  getVal('settingsDOB') || null,
    };

    try {
        const data = await apiFetch('/api/auth/profile/', 'PATCH', payload);
        updateLocalUser(data);
        showToast('Account settings saved!', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to save account settings', 'error');
    } finally {
        setLoading(btn, false);
    }
}

// ── Profile ───────────────────────────────────────────────────────────────────

async function saveProfileSettings() {
    const btn = event.currentTarget;
    setLoading(btn, true);

    const payload = {
        display_name: getVal('settingsDisplayName'),
        bio:          getVal('settingsBio'),
        location:     getVal('settingsLocation'),
        website:      getVal('settingsWebsite'),
    };

    try {
        const data = await apiFetch('/api/auth/profile/', 'PATCH', payload);
        updateLocalUser(data);
        // Update avatar name label
        const nameEl = document.getElementById('settingsAvatarName');
        if (nameEl) nameEl.textContent = data.display_name || data.username;
        showToast('Profile updated!', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to update profile', 'error');
    } finally {
        setLoading(btn, false);
    }
}

async function changeAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            showToast('Image must be under 5 MB', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('avatar', file);

        try {
            const token = getAuthToken();
            const res = await fetch(`${getApiBase()}/api/auth/avatar/`, {
                method: 'POST',
                headers: { 'Authorization': `Token ${token}` },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Upload failed');

            // Preview
            const preview = document.getElementById('settingsAvatarPreview');
            if (preview) preview.innerHTML = `<img src="${data.avatar_url}" alt="Avatar">`;

            const user = JSON.parse(localStorage.getItem('user') || '{}');
            user.profile_image = data.avatar_url;
            localStorage.setItem('user', JSON.stringify(user));

            showToast('Avatar updated!', 'success');
        } catch (err) {
            showToast(err.message || 'Failed to upload avatar', 'error');
        }
    };
    input.click();
}

// ── Privacy ───────────────────────────────────────────────────────────────────

async function savePrivacySettings() {
    const btn = event.currentTarget;
    setLoading(btn, true);

    const prefs = {
        profileVisibility: getVal('profileVisibility'),
        messagePrivacy:    getVal('messagePrivacy'),
        showOnlineStatus:  getChecked('showOnlineStatus'),
        showActivity:      getChecked('showActivity'),
        showStats:         getChecked('showStats'),
    };

    await savePreferences(prefs, btn, 'Privacy settings saved!');
}

// ── Notifications ─────────────────────────────────────────────────────────────

async function saveNotificationSettings() {
    const btn = event.currentTarget;
    setLoading(btn, true);

    const prefs = {
        pushNotifications:       getChecked('pushNotifications'),
        emailNotifications:      getChecked('emailNotifications'),
        challengeNotifications:  getChecked('challengeNotifications'),
        messageNotifications:    getChecked('messageNotifications'),
        allianceNotifications:   getChecked('allianceNotifications'),
        tournamentNotifications: getChecked('tournamentNotifications'),
        soundEffects:            getChecked('soundEffects'),
    };

    await savePreferences(prefs, btn, 'Notification settings saved!');
}

// ── Appearance ────────────────────────────────────────────────────────────────

async function saveAppearanceSettings() {
    const btn = event.currentTarget;
    setLoading(btn, true);

    const prefs = {
        theme:            getVal('themeSelect'),
        fontSize:         getVal('fontSize'),
        enableAnimations: getChecked('enableAnimations'),
        compactMode:      getChecked('compactMode'),
    };

    // Persist accent colour already stored live
    const stored = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    if (stored.accentColor) prefs.accentColor = stored.accentColor;

    applyAppearanceSettings(prefs);
    await savePreferences(prefs, btn, 'Appearance saved!');
}

function changeTheme() {
    const theme = getVal('themeSelect');
    applyTheme(theme);
    patchLocalPrefs({ theme });
}

function selectAccentColor(color) {
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.documentElement.style.setProperty('--accent-color', color);
    patchLocalPrefs({ accentColor: color });
}

function changeFontSize() {
    const size = getVal('fontSize');
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add(`font-${size}`);
    patchLocalPrefs({ fontSize: size });
}

function applyAppearanceSettings(prefs) {
    if (!prefs) prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    applyTheme(prefs.theme || 'dark');
    if (prefs.accentColor) document.documentElement.style.setProperty('--accent-color', prefs.accentColor);
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    if (prefs.fontSize) document.body.classList.add(`font-${prefs.fontSize}`);
    document.body.classList.toggle('no-animations', prefs.enableAnimations === false);
    document.body.classList.toggle('compact-mode',  prefs.compactMode === true);
}

function applyTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('light-theme', !prefersDark);
    } else {
        document.body.classList.toggle('light-theme', theme === 'light');
    }
}

// ── Security ──────────────────────────────────────────────────────────────────

async function changePassword() {
    const currentPassword = getVal('currentPassword');
    const newPassword     = getVal('newPassword');
    const confirmPassword = getVal('confirmPassword');
    const btn = event.currentTarget;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showToast('Please fill in all password fields', 'error'); return;
    }
    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match', 'error'); return;
    }
    if (newPassword.length < 8) {
        showToast('Password must be at least 8 characters', 'error'); return;
    }

    setLoading(btn, true);
    try {
        const data = await apiFetch('/api/auth/change-password/', 'POST', {
            current_password: currentPassword,
            new_password:     newPassword,
        });

        // Server rotates the token — update it locally
        if (data.token) {
            localStorage.setItem('token', data.token);
        }

        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value     = '';
        document.getElementById('confirmPassword').value = '';
        document.getElementById('passwordStrength').style.display = 'none';

        showToast('Password changed successfully!', 'success');
    } catch (err) {
        showToast(err.message || 'Failed to change password', 'error');
    } finally {
        setLoading(btn, false);
    }
}

function checkPasswordStrength(value) {
    const bar    = document.getElementById('strengthFill');
    const label  = document.getElementById('strengthLabel');
    const wrap   = document.getElementById('passwordStrength');
    if (!bar || !label || !wrap) return;

    wrap.style.display = value.length ? 'flex' : 'none';

    let score = 0;
    if (value.length >= 8)              score++;
    if (value.length >= 12)             score++;
    if (/[A-Z]/.test(value))            score++;
    if (/[0-9]/.test(value))            score++;
    if (/[^A-Za-z0-9]/.test(value))     score++;

    const levels = [
        { pct: '20%',  color: '#ff4444', text: 'Very Weak'  },
        { pct: '40%',  color: '#ff8800', text: 'Weak'       },
        { pct: '60%',  color: '#ffcc00', text: 'Fair'       },
        { pct: '80%',  color: '#88cc00', text: 'Strong'     },
        { pct: '100%', color: '#4caf50', text: 'Very Strong' },
    ];
    const l = levels[Math.min(score, 4)];
    bar.style.width      = l.pct;
    bar.style.background = l.color;
    label.textContent    = l.text;
    label.style.color    = l.color;
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.querySelector('i').className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
}

async function loadActiveSessions() {
    const list = document.getElementById('sessionsList');
    if (!list) return;

    try {
        const data = await apiFetch('/api/auth/sessions/', 'GET');
        if (!data.sessions || data.sessions.length === 0) {
            list.innerHTML = '<p class="sessions-empty">No active sessions found.</p>';
            return;
        }

        list.innerHTML = data.sessions.map(s => `
            <div class="session-card ${s.is_current ? 'current' : ''}">
                <span class="session-device-icon">
                    <i class="fas fa-${s.is_current ? 'desktop' : 'globe'}"></i>
                </span>
                <div class="session-details">
                    <strong>${s.is_current ? 'This Device' : 'Other Device'}</strong>
                    <span>Token ending in ${s.key_preview} &middot; ${formatDate(s.created)}</span>
                </div>
                ${s.is_current ? '<span class="session-badge-current">Current</span>' : ''}
            </div>
        `).join('');
    } catch {
        list.innerHTML = '<p class="sessions-empty">Could not load sessions.</p>';
    }
}

function setup2FA() {
    showToast('2FA setup coming soon!', 'info');
}

async function logoutAllDevices() {
    if (!confirm('Logout from all devices? You will need to sign in again on every device.')) return;
    const btn = event.currentTarget;
    setLoading(btn, true);
    try {
        await apiFetch('/api/auth/logout-all/', 'POST');
        showToast('Logged out from all devices', 'success');
        setTimeout(() => { if (typeof logout === 'function') logout(); }, 1500);
    } catch (err) {
        showToast(err.message || 'Failed to logout all devices', 'error');
        setLoading(btn, false);
    }
}

// ── Danger Zone ───────────────────────────────────────────────────────────────

async function deactivateAccount() {
    const password = prompt('Enter your password to deactivate your account:');
    if (!password) return;

    try {
        await apiFetch('/api/auth/deactivate/', 'POST', { password });
        showToast('Account deactivated. Signing you out…', 'info');
        setTimeout(() => { if (typeof logout === 'function') logout(); }, 2000);
    } catch (err) {
        showToast(err.message || 'Failed to deactivate account', 'error');
    }
}

async function deleteAccount() {
    const confirmed = confirm(
        '⚠️ This will permanently delete your account and all your data.\nThis action cannot be undone.\n\nAre you absolutely sure?'
    );
    if (!confirmed) return;

    const password = prompt('Enter your password to confirm:');
    if (!password) return;

    try {
        await apiFetch('/api/auth/delete-account/', 'POST', { password, confirm: 'DELETE' });
        showToast('Account deleted. Goodbye!', 'info');
        setTimeout(() => { if (typeof logout === 'function') logout(); }, 2000);
    } catch (err) {
        showToast(err.message || 'Failed to delete account', 'error');
    }
}

// ── Linked Accounts ───────────────────────────────────────────────────────

function loadLinkedAccounts() {
    const user = getStoredUser();
    const connections = user.social_connections || {};
    const platforms = ['twitter', 'instagram', 'youtube', 'tiktok', 'facebook'];

    platforms.forEach(p => {
        const conn = connections[p] || {};
        const handleEl = document.getElementById(`lpHandle${capitalize(p)}`);
        const btnEl    = document.getElementById(`lpBtn${capitalize(p)}`);
        const rowEl    = document.querySelector(`[data-platform="${p}"]`);

        if (!handleEl || !btnEl) return;

        if (conn.connected) {
            handleEl.textContent = `@${conn.username || p}`;
            handleEl.classList.add('connected-handle');
            btnEl.textContent = 'Disconnect';
            btnEl.classList.add('disconnect-btn');
            if (rowEl) rowEl.classList.add('connected');
        } else {
            handleEl.textContent = 'Not connected';
            handleEl.classList.remove('connected-handle');
            btnEl.textContent = 'Connect';
            btnEl.classList.remove('disconnect-btn');
            if (rowEl) rowEl.classList.remove('connected');
        }
    });
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

async function toggleSocialLink(platform) {
    const user = getStoredUser();
    const connections = user.social_connections || {};
    const isConnected = connections[platform] && connections[platform].connected;

    if (isConnected) {
        // Disconnect
        if (!confirm(`Disconnect your ${capitalize(platform)} account?`)) return;
        const updated = { ...connections };
        updated[platform] = { connected: false };
        try {
            const data = await apiFetch('/api/auth/profile/', 'PATCH', {
                social_connections: updated,
            });
            updateLocalUser(data);
            loadLinkedAccounts();
            showToast(`${capitalize(platform)} disconnected`, 'info');
        } catch (err) {
            showToast(err.message || 'Failed to disconnect', 'error');
        }
    } else {
        // Connect — prompt for username
        const handle = prompt(`Enter your ${capitalize(platform)} username (without @):`);
        if (!handle || !handle.trim()) return;
        const updated = { ...connections };
        updated[platform] = { connected: true, username: handle.trim(), verified: false };
        try {
            const data = await apiFetch('/api/auth/profile/', 'PATCH', {
                social_connections: updated,
            });
            updateLocalUser(data);
            loadLinkedAccounts();
            showToast(`${capitalize(platform)} linked!`, 'success');
        } catch (err) {
            showToast(err.message || 'Failed to link account', 'error');
        }
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function getVal(id)     { const el = document.getElementById(id); return el ? el.value.trim() : ''; }
function getChecked(id) { const el = document.getElementById(id); return el ? el.checked : false; }

/** Canonical token key — same as auth.js / app.js */
function getAuthToken() {
    return localStorage.getItem('djangoAuthToken') || localStorage.getItem('token') || '';
}

/** Canonical user object — same keys as auth.js / app.js */
function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem('artxUser') || localStorage.getItem('user') || '{}');
    } catch { return {}; }
}

function getApiBase() {
    if (typeof API_BASE_URL !== 'undefined' && API_BASE_URL) {
        // API_BASE_URL is already like "http://localhost:8000/api" — strip the /api suffix
        return API_BASE_URL.replace(/\/api\/?$/, '');
    }
    return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000'
        : window.location.origin;
}

async function apiFetch(path, method = 'GET', body = null) {
    const token = getAuthToken();
    const opts  = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${token}`,
        },
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    const res  = await fetch(`${getApiBase()}${path}`, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.detail || `Request failed (${res.status})`);
    return data;
}

async function savePreferences(prefs, btn, successMsg) {
    // Always persist locally first for offline resilience
    patchLocalPrefs(prefs);
    try {
        await apiFetch('/api/auth/preferences/', 'PATCH', prefs);
        showToast(successMsg, 'success');
    } catch (err) {
        // Already saved locally — still surface the server error
        showToast((err.message || 'Server save failed') + ' (saved locally)', 'warning');
    } finally {
        setLoading(btn, false);
    }
}

function patchLocalPrefs(patch) {
    const prefs = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    Object.assign(prefs, patch);
    localStorage.setItem('userPreferences', JSON.stringify(prefs));
}

function updateLocalUser(data) {
    // Update both key names so every script stays in sync
    const user = getStoredUser();
    Object.assign(user, data);
    localStorage.setItem('artxUser', JSON.stringify(user));
    localStorage.setItem('user', JSON.stringify(user));  // legacy compat
}

function setLoading(btn, state) {
    if (!btn) return;
    btn.disabled = state;
    btn.classList.toggle('loading', state);
}

function formatDate(isoStr) {
    if (!isoStr) return 'Unknown';
    try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoStr));
    } catch { return isoStr; }
}

// ── Toast notifications ───────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    // Remove existing toasts of the same message to avoid spam
    document.querySelectorAll('.artx-toast').forEach(t => {
        if (t.dataset.msg === message) t.remove();
    });

    const icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle', warning: 'exclamation-triangle' };
    const toast = document.createElement('div');
    toast.className = `artx-toast artx-toast-${type}`;
    toast.dataset.msg = message;
    toast.innerHTML = `
        <i class="fas fa-${icons[type] || 'info-circle'}"></i>
        <span>${message}</span>
        <button class="toast-close" onclick="this.closest('.artx-toast').remove()" aria-label="Dismiss">&times;</button>
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));

    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 350);
    }, 4000);
}

// Keep backward compat alias
function showNotification(msg, type) { showToast(msg, type); }

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    applyAppearanceSettings();
});
