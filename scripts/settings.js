// Settings Modal Functions

function getAuthToken() {
    return localStorage.getItem('djangoAuthToken') || localStorage.getItem('token') || '';
}

function getStoredUser() {
    return JSON.parse(localStorage.getItem('artxUser') || localStorage.getItem('user') || '{}');
}

function showSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'block';
        loadUserSettings();
    }
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showSettingsTab(tabName, event) {
    if (!tabName) return;

    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(tab => tab.classList.remove('active'));

    const navBtns = document.querySelectorAll('.settings-nav-btn');
    navBtns.forEach(btn => btn.classList.remove('active'));

    const selectedTab = document.getElementById(`${tabName}Tab`);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }

    let targetBtn = null;
    if (event && event.target) {
        targetBtn = event.target.closest('.settings-nav-btn');
    }
    if (!targetBtn) {
        targetBtn = document.querySelector(`.settings-nav-btn[data-tab="${tabName}"]`);
    }
    if (targetBtn) {
        targetBtn.classList.add('active');
    }
}

function loadUserSettings() {
    const user = getStoredUser();

    // Account settings
    const usernameInput = document.getElementById('settingsUsername');
    const emailInput = document.getElementById('settingsEmail');
    const phoneInput = document.getElementById('settingsPhone');
    const dobInput = document.getElementById('settingsDOB');

    if (usernameInput) usernameInput.value = user.username || user.display_name || '';
    if (emailInput) emailInput.value = user.email || '';
    if (phoneInput) phoneInput.value = user.phone || user.phone_number || '';
    if (dobInput) dobInput.value = user.date_of_birth || user.dob || '';

    // Profile settings
    const displayNameInput = document.getElementById('settingsDisplayName');
    const bioInput = document.getElementById('settingsBio');
    const locationInput = document.getElementById('settingsLocation');
    const websiteInput = document.getElementById('settingsWebsite');
    const avatarName = document.getElementById('settingsAvatarName');
    const avatarPreview = document.getElementById('settingsAvatarPreview');

    const displayNameValue = user.display_name || user.username || 'Player';
    if (displayNameInput) displayNameInput.value = displayNameValue;
    if (bioInput) bioInput.value = user.bio || '';
    if (locationInput) locationInput.value = user.location || '';
    if (websiteInput) websiteInput.value = user.website || user.website_url || '';
    if (avatarName) avatarName.textContent = displayNameValue;

    if (avatarPreview) {
        const imageUrl = user.profile_image || user.avatar_url || user.avatar || '';
        if (imageUrl) {
            avatarPreview.innerHTML = `<img src="${imageUrl}" alt="Avatar" />`;
        } else {
            avatarPreview.innerHTML = '<i class="fas fa-user-circle"></i>';
        }
    }

    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');

    if (document.getElementById('profileVisibility')) {
        document.getElementById('profileVisibility').value = preferences.profileVisibility || 'public';
    }
    if (document.getElementById('messagePrivacy')) {
        document.getElementById('messagePrivacy').value = preferences.messagePrivacy || 'everyone';
    }
    if (document.getElementById('showOnlineStatus')) {
        document.getElementById('showOnlineStatus').checked = preferences.showOnlineStatus !== false;
    }
    if (document.getElementById('showActivity')) {
        document.getElementById('showActivity').checked = preferences.showActivity !== false;
    }
    if (document.getElementById('showStats')) {
        document.getElementById('showStats').checked = preferences.showStats !== false;
    }

    if (document.getElementById('pushNotifications')) {
        document.getElementById('pushNotifications').checked = preferences.pushNotifications !== false;
    }
    if (document.getElementById('emailNotifications')) {
        document.getElementById('emailNotifications').checked = preferences.emailNotifications !== false;
    }
    if (document.getElementById('challengeNotifications')) {
        document.getElementById('challengeNotifications').checked = preferences.challengeNotifications !== false;
    }
    if (document.getElementById('messageNotifications')) {
        document.getElementById('messageNotifications').checked = preferences.messageNotifications !== false;
    }
    if (document.getElementById('allianceNotifications')) {
        document.getElementById('allianceNotifications').checked = preferences.allianceNotifications !== false;
    }
    if (document.getElementById('tournamentNotifications')) {
        document.getElementById('tournamentNotifications').checked = preferences.tournamentNotifications !== false;
    }
    if (document.getElementById('soundEffects')) {
        document.getElementById('soundEffects').checked = preferences.soundEffects !== false;
    }

    if (document.getElementById('themeSelect')) {
        document.getElementById('themeSelect').value = preferences.theme || 'dark';
    }
    if (document.getElementById('fontSize')) {
        document.getElementById('fontSize').value = preferences.fontSize || 'medium';
    }
    if (document.getElementById('enableAnimations')) {
        document.getElementById('enableAnimations').checked = preferences.enableAnimations !== false;
    }
    if (document.getElementById('compactMode')) {
        document.getElementById('compactMode').checked = preferences.compactMode === true;
    }

    setAccentSwatch(preferences.accentColor || '#90ee90');
    applyAppearanceSettings();
    loadActiveSessions();
}

function setAccentSwatch(color) {
    document.querySelectorAll('.color-swatch').forEach(option => {
        option.classList.toggle('active', option.dataset.color === color);
    });
    document.documentElement.style.setProperty('--accent-color', color);
}

async function saveAccountSettings() {
    const username = document.getElementById('settingsUsername').value.trim();
    const email = document.getElementById('settingsEmail').value.trim();
    const phone = document.getElementById('settingsPhone').value.trim();
    const dob = document.getElementById('settingsDOB').value;

    if (!username || !email) {
        showNotification('Username and email are required', 'error');
        return;
    }

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify({
                username,
                email,
                phone,
                date_of_birth: dob
            })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('artxUser', JSON.stringify(data));
            showNotification('Account settings saved successfully!', 'success');
            loadUserSettings();
        } else {
            const data = await response.json().catch(() => ({}));
            showNotification(data.error || 'Failed to save account settings', 'error');
        }
    } catch (error) {
        console.error('Error saving account settings:', error);
        showNotification('Error saving account settings', 'error');
    }
}

async function saveProfileSettings() {
    const displayName = document.getElementById('settingsDisplayName').value.trim();
    const bio = document.getElementById('settingsBio').value.trim();
    const location = document.getElementById('settingsLocation').value.trim();
    const website = document.getElementById('settingsWebsite').value.trim();

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify({
                display_name: displayName,
                bio,
                location,
                website
            })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('artxUser', JSON.stringify(data));
            showNotification('Profile updated successfully!', 'success');
            loadUserSettings();
        } else {
            const data = await response.json().catch(() => ({}));
            showNotification(data.error || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        showNotification('Error updating profile', 'error');
    }
}

async function saveUserPreferences(preferences, message) {
    const stored = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    const merged = { ...stored, ...preferences };
    localStorage.setItem('userPreferences', JSON.stringify(merged));

    const token = getAuthToken();
    if (!token) {
        showNotification(message, 'success');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/users/preferences/`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify(merged)
        });

        if (response.ok) {
            showNotification(message, 'success');
            if (preferences.accentColor) {
                setAccentSwatch(preferences.accentColor);
            }
        } else {
            const data = await response.json().catch(() => ({}));
            showNotification(data.error || `Unable to save preferences.`, 'error');
        }
    } catch (error) {
        console.error('Error saving preferences:', error);
        showNotification(`Unable to save preferences.`, 'error');
    }
}

function savePrivacySettings() {
    const preferences = {
        profileVisibility: document.getElementById('profileVisibility').value,
        messagePrivacy: document.getElementById('messagePrivacy').value,
        showOnlineStatus: document.getElementById('showOnlineStatus').checked,
        showActivity: document.getElementById('showActivity').checked,
        showStats: document.getElementById('showStats').checked
    };

    saveUserPreferences(preferences, 'Privacy settings saved!');
}

function saveNotificationSettings() {
    const preferences = {
        pushNotifications: document.getElementById('pushNotifications').checked,
        emailNotifications: document.getElementById('emailNotifications').checked,
        soundEffects: document.getElementById('soundEffects').checked,
        challengeNotifications: document.getElementById('challengeNotifications').checked,
        messageNotifications: document.getElementById('messageNotifications').checked,
        allianceNotifications: document.getElementById('allianceNotifications').checked,
        tournamentNotifications: document.getElementById('tournamentNotifications').checked
    };

    saveUserPreferences(preferences, 'Notification settings saved!');
}

function saveAppearanceSettings() {
    const preferences = {
        theme: document.getElementById('themeSelect').value,
        fontSize: document.getElementById('fontSize').value,
        enableAnimations: document.getElementById('enableAnimations').checked,
        compactMode: document.getElementById('compactMode').checked
    };

    saveUserPreferences(preferences, 'Appearance settings saved!');
    applyAppearanceSettings();
}

function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.theme = theme;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    applyAppearanceSettings();
}

function selectAccentColor(color) {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.accentColor = color;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    setAccentSwatch(color);
    applyAppearanceSettings();
}

function changeFontSize() {
    const fontSize = document.getElementById('fontSize').value;
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.fontSize = fontSize;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    applyAppearanceSettings();
}

function applyAppearanceSettings() {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    const theme = preferences.theme || 'dark';

    document.body.classList.remove('light-theme');
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else if (theme === 'auto') {
        const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
        document.body.classList.toggle('light-theme', prefersLight);
    }

    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add(`font-${preferences.fontSize || 'medium'}`);

    document.body.classList.toggle('no-animations', preferences.enableAnimations === false);
    document.body.classList.toggle('compact-mode', preferences.compactMode === true);

    if (preferences.accentColor) {
        document.documentElement.style.setProperty('--accent-color', preferences.accentColor);
    }
}

function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    if (button) {
        const icon = button.querySelector('i');
        if (icon) {
            icon.className = input.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
        }
    }
}

function checkPasswordStrength(password) {
    const strengthFill = document.getElementById('strengthFill');
    const strengthLabel = document.getElementById('strengthLabel');
    if (!strengthFill || !strengthLabel) return;

    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    const percent = Math.min(100, score * 20);
    strengthFill.style.width = `${percent}%`;

    if (percent <= 40) {
        strengthFill.style.background = '#ff6b6b';
        strengthLabel.textContent = 'Weak';
    } else if (percent <= 80) {
        strengthFill.style.background = '#f0ad4e';
        strengthLabel.textContent = 'Fair';
    } else {
        strengthFill.style.background = '#90ee90';
        strengthLabel.textContent = 'Strong';
    }
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword || !newPassword || !confirmPassword) {
        showNotification('Please fill in all password fields', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showNotification('New passwords do not match', 'error');
        return;
    }
    if (newPassword.length < 8) {
        showNotification('Password must be at least 8 characters', 'error');
        return;
    }

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/users/change-password/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${token}`
            },
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        if (response.ok) {
            showNotification('Password changed successfully!', 'success');
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            checkPasswordStrength('');
        } else {
            const data = await response.json().catch(() => ({}));
            showNotification(data.error || 'Failed to change password', 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showNotification('Error changing password', 'error');
    }
}

function changeAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png, image/jpeg, image/gif';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showNotification('Avatar must be 5 MB or smaller', 'error');
            return;
        }

        const token = getAuthToken();
        if (!token) {
            showNotification('Authentication required', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('profile_image', file);

        try {
            const response = await fetch(`${API_BASE_URL}/auth/profile/`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Token ${token}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                const avatarPreview = document.getElementById('settingsAvatarPreview');
                if (avatarPreview) {
                    avatarPreview.innerHTML = `<img src="${data.profile_image || data.avatar_url || URL.createObjectURL(file)}" alt="Avatar" />`;
                }
                localStorage.setItem('artxUser', JSON.stringify(data));
                showNotification('Avatar updated successfully!', 'success');
            } else {
                showNotification('Failed to upload avatar', 'error');
            }
        } catch (error) {
            console.error('Error uploading avatar:', error);
            showNotification('Error uploading avatar', 'error');
        }
    };
    input.click();
}

function setup2FA() {
    const enabled = document.getElementById('enable2FA').checked;
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.enable2FA = enabled;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));

    showNotification(enabled ? 'Two-factor authentication enabled. Use your authenticator app to scan the code.' : 'Two-factor authentication disabled.', 'info');
}

async function logoutAllDevices() {
    if (!confirm('Are you sure you want to logout from all devices?')) return;

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/users/logout-all/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${token}`
            }
        });

        if (response.ok) {
            showNotification('Logged out from all devices', 'success');
            localStorage.removeItem('djangoAuthToken');
            setTimeout(() => { window.location.href = 'pages/auth.html'; }, 1200);
        } else {
            showNotification('Failed to logout from all devices', 'error');
        }
    } catch (error) {
        console.error('Error logging out:', error);
        showNotification('Error logging out from all devices', 'error');
    }
}

async function loadActiveSessions() {
    const sessionsList = document.getElementById('sessionsList');
    if (!sessionsList) return;
    sessionsList.innerHTML = '<div class="sessions-loading"><i class="fas fa-spinner fa-spin"></i> Loading sessions...</div>';

    const token = getAuthToken();
    if (!token) {
        sessionsList.innerHTML = '<div class="empty-state">Login required to view active sessions.</div>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/users/sessions/`, {
            headers: {
                'Authorization': `Token ${token}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            const sessions = data.sessions || [];
            if (!sessions.length) {
                sessionsList.innerHTML = '<div class="empty-state"><i class="fas fa-info-circle"></i> No active sessions found.</div>';
                return;
            }

            sessionsList.innerHTML = sessions.map(session => {
                const isCurrent = session.current || session.current_session || session.is_current;
                const device = session.device || session.device_type || 'Web browser';
                const location = session.location || session.ip || 'Unknown location';
                const lastSeen = session.last_activity || session.last_active || session.updated_at || 'Recently';
                return `
                    <div class="session-item">
                        <div class="session-info">
                            <i class="fas fa-laptop"></i>
                            <div>
                                <h5>${device}</h5>
                                <p>${location} · ${lastSeen}</p>
                            </div>
                        </div>
                        <span class="session-badge ${isCurrent ? 'current' : ''}">${isCurrent ? 'Current' : 'Active'}</span>
                    </div>
                `;
            }).join('');
        } else {
            sessionsList.innerHTML = '<div class="empty-state">Unable to load sessions.</div>';
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        sessionsList.innerHTML = '<div class="empty-state">Failed to load session data.</div>';
    }
}

function deactivateAccount() {
    if (!confirm('Are you sure you want to deactivate your account? You can reactivate it later by logging in.')) return;

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    fetch(`${API_BASE_URL}/users/deactivate/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${token}` }
    })
    .then(response => {
        if (response.ok) {
            showNotification('Your account has been deactivated. You can reactivate it by logging in again.', 'success');
            localStorage.removeItem('djangoAuthToken');
            setTimeout(() => { window.location.href = 'pages/auth.html'; }, 1200);
        } else {
            showNotification('Unable to deactivate account at this time.', 'error');
        }
    })
    .catch(error => {
        console.error('Error deactivating account:', error);
        showNotification('Error deactivating account', 'error');
    });
}

function deleteAccount() {
    if (!confirm('Are you sure you want to permanently delete your account? This action cannot be undone!')) return;

    const confirmText = prompt('Type "DELETE" to confirm account deletion:');
    if (confirmText !== 'DELETE') {
        showNotification('Account deletion cancelled', 'info');
        return;
    }

    const token = getAuthToken();
    if (!token) {
        showNotification('Authentication required', 'error');
        return;
    }

    fetch(`${API_BASE_URL}/users/delete-account/`, {
        method: 'POST',
        headers: { 'Authorization': `Token ${token}` }
    })
    .then(response => {
        if (response.ok) {
            showNotification('Your account has been deleted.', 'success');
            localStorage.removeItem('djangoAuthToken');
            setTimeout(() => { window.location.href = 'pages/auth.html'; }, 1200);
        } else {
            showNotification('Unable to delete account at this time.', 'error');
        }
    })
    .catch(error => {
        console.error('Error deleting account:', error);
        showNotification('Error deleting account', 'error');
    });
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 100);
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function handleSettingsOverlayClick(event) {
    const modal = document.getElementById('settingsModal');
    if (event.target === modal) {
        closeSettings();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    applyAppearanceSettings();
});

window.addEventListener('click', handleSettingsOverlayClick);
