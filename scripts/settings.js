// Settings Modal Functions

// Show Settings Modal
function showSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'block';
        loadUserSettings();
    }
}

// Close Settings Modal
function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Show Settings Tab
function showSettingsTab(tabName) {
    // Hide all tabs
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    
    // Remove active class from all nav buttons
    const navBtns = document.querySelectorAll('.settings-nav-btn');
    navBtns.forEach(btn => btn.classList.remove('active'));
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName + 'Tab');
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Add active class to clicked nav button
    event.target.closest('.settings-nav-btn').classList.add('active');
}

// Load User Settings
function loadUserSettings() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    
    // Account settings
    if (document.getElementById('settingsUsername')) {
        document.getElementById('settingsUsername').value = user.username || '';
    }
    if (document.getElementById('settingsEmail')) {
        document.getElementById('settingsEmail').value = user.email || '';
    }
    if (document.getElementById('settingsPhone')) {
        document.getElementById('settingsPhone').value = user.phone || '';
    }
    
    // Profile settings
    if (document.getElementById('settingsDisplayName')) {
        document.getElementById('settingsDisplayName').value = user.displayName || user.username || '';
    }
    if (document.getElementById('settingsBio')) {
        document.getElementById('settingsBio').value = user.bio || '';
    }
    if (document.getElementById('settingsLocation')) {
        document.getElementById('settingsLocation').value = user.location || '';
    }
    if (document.getElementById('settingsWebsite')) {
        document.getElementById('settingsWebsite').value = user.website || '';
    }
    
    // Load preferences from localStorage
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    
    // Privacy settings
    if (document.getElementById('profileVisibility')) {
        document.getElementById('profileVisibility').value = preferences.profileVisibility || 'public';
    }
    if (document.getElementById('showOnlineStatus')) {
        document.getElementById('showOnlineStatus').checked = preferences.showOnlineStatus !== false;
    }
    if (document.getElementById('showActivity')) {
        document.getElementById('showActivity').checked = preferences.showActivity !== false;
    }
    if (document.getElementById('messagePrivacy')) {
        document.getElementById('messagePrivacy').value = preferences.messagePrivacy || 'everyone';
    }
    if (document.getElementById('showStats')) {
        document.getElementById('showStats').checked = preferences.showStats !== false;
    }
    
    // Notification settings
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
    
    // Appearance settings
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
    
    // Security settings
    if (document.getElementById('enable2FA')) {
        document.getElementById('enable2FA').checked = user.twoFactorEnabled === true;
    }
}

// Save Account Settings
async function saveAccountSettings() {
    const username = document.getElementById('settingsUsername').value;
    const email = document.getElementById('settingsEmail').value;
    const phone = document.getElementById('settingsPhone').value;
    const dob = document.getElementById('settingsDOB').value;
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/users/profile/`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
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
            localStorage.setItem('user', JSON.stringify(data));
            showNotification('Account settings saved successfully!', 'success');
        } else {
            showNotification('Failed to save account settings', 'error');
        }
    } catch (error) {
        console.error('Error saving account settings:', error);
        showNotification('Error saving account settings', 'error');
    }
}

// Save Profile Settings
async function saveProfileSettings() {
    const displayName = document.getElementById('settingsDisplayName').value;
    const bio = document.getElementById('settingsBio').value;
    const location = document.getElementById('settingsLocation').value;
    const website = document.getElementById('settingsWebsite').value;
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/users/profile/`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
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
            localStorage.setItem('user', JSON.stringify(data));
            showNotification('Profile updated successfully!', 'success');
        } else {
            showNotification('Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Error saving profile:', error);
        showNotification('Error updating profile', 'error');
    }
}

// Save Privacy Settings
function savePrivacySettings() {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    
    preferences.profileVisibility = document.getElementById('profileVisibility').value;
    preferences.showOnlineStatus = document.getElementById('showOnlineStatus').checked;
    preferences.showActivity = document.getElementById('showActivity').checked;
    preferences.messagePrivacy = document.getElementById('messagePrivacy').value;
    preferences.showStats = document.getElementById('showStats').checked;
    
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    showNotification('Privacy settings saved!', 'success');
}

// Save Notification Settings
function saveNotificationSettings() {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    
    preferences.pushNotifications = document.getElementById('pushNotifications').checked;
    preferences.emailNotifications = document.getElementById('emailNotifications').checked;
    preferences.challengeNotifications = document.getElementById('challengeNotifications').checked;
    preferences.messageNotifications = document.getElementById('messageNotifications').checked;
    preferences.allianceNotifications = document.getElementById('allianceNotifications').checked;
    preferences.tournamentNotifications = document.getElementById('tournamentNotifications').checked;
    preferences.soundEffects = document.getElementById('soundEffects').checked;
    
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    showNotification('Notification settings saved!', 'success');
}

// Save Appearance Settings
function saveAppearanceSettings() {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    
    preferences.theme = document.getElementById('themeSelect').value;
    preferences.fontSize = document.getElementById('fontSize').value;
    preferences.enableAnimations = document.getElementById('enableAnimations').checked;
    preferences.compactMode = document.getElementById('compactMode').checked;
    
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
    
    // Apply settings immediately
    applyAppearanceSettings();
    
    showNotification('Appearance settings saved!', 'success');
}

// Change Theme
function changeTheme() {
    const theme = document.getElementById('themeSelect').value;
    
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    
    // Save preference
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.theme = theme;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
}

// Select Accent Color
function selectAccentColor(color) {
    // Remove active class from all color options
    document.querySelectorAll('.color-option').forEach(option => {
        option.classList.remove('active');
    });
    
    // Add active class to selected color
    event.target.classList.add('active');
    
    // Apply color
    document.documentElement.style.setProperty('--accent-color', color);
    
    // Save preference
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.accentColor = color;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
}

// Change Font Size
function changeFontSize() {
    const fontSize = document.getElementById('fontSize').value;
    
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add(`font-${fontSize}`);
    
    // Save preference
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    preferences.fontSize = fontSize;
    localStorage.setItem('userPreferences', JSON.stringify(preferences));
}

// Apply Appearance Settings
function applyAppearanceSettings() {
    const preferences = JSON.parse(localStorage.getItem('userPreferences') || '{}');
    
    // Apply theme
    if (preferences.theme === 'light') {
        document.body.classList.add('light-theme');
    }
    
    // Apply accent color
    if (preferences.accentColor) {
        document.documentElement.style.setProperty('--accent-color', preferences.accentColor);
    }
    
    // Apply font size
    if (preferences.fontSize) {
        document.body.classList.add(`font-${preferences.fontSize}`);
    }
    
    // Apply animations
    if (preferences.enableAnimations === false) {
        document.body.classList.add('no-animations');
    }
    
    // Apply compact mode
    if (preferences.compactMode === true) {
        document.body.classList.add('compact-mode');
    }
}

// Change Password
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
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/users/change-password/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
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
        } else {
            const data = await response.json();
            showNotification(data.error || 'Failed to change password', 'error');
        }
    } catch (error) {
        console.error('Error changing password:', error);
        showNotification('Error changing password', 'error');
    }
}

// Change Avatar
function changeAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const formData = new FormData();
            formData.append('avatar', file);
            
            try {
                const token = localStorage.getItem('token');
                const response = await fetch(`${API_BASE_URL}/users/avatar/`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: formData
                });
                
                if (response.ok) {
                    const data = await response.json();
                    showNotification('Avatar updated successfully!', 'success');
                    // Update avatar preview
                    const avatarPreview = document.querySelector('.avatar-preview');
                    if (avatarPreview && data.avatar_url) {
                        avatarPreview.innerHTML = `<img src="${data.avatar_url}" alt="Avatar" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">`;
                    }
                } else {
                    showNotification('Failed to upload avatar', 'error');
                }
            } catch (error) {
                console.error('Error uploading avatar:', error);
                showNotification('Error uploading avatar', 'error');
            }
        }
    };
    input.click();
}

// Setup 2FA
function setup2FA() {
    showNotification('2FA setup coming soon!', 'info');
}

// Logout All Devices
async function logoutAllDevices() {
    if (!confirm('Are you sure you want to logout from all devices?')) {
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}/users/logout-all/`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            showNotification('Logged out from all devices', 'success');
            setTimeout(() => {
                logout();
            }, 1500);
        } else {
            showNotification('Failed to logout from all devices', 'error');
        }
    } catch (error) {
        console.error('Error logging out:', error);
        showNotification('Error logging out from all devices', 'error');
    }
}

// Deactivate Account
function deactivateAccount() {
    if (!confirm('Are you sure you want to deactivate your account? You can reactivate it later by logging in.')) {
        return;
    }
    
    showNotification('Account deactivation coming soon!', 'info');
}

// Delete Account
function deleteAccount() {
    if (!confirm('Are you sure you want to permanently delete your account? This action cannot be undone!')) {
        return;
    }
    
    const confirmText = prompt('Type "DELETE" to confirm account deletion:');
    if (confirmText !== 'DELETE') {
        showNotification('Account deletion cancelled', 'info');
        return;
    }
    
    showNotification('Account deletion coming soon!', 'info');
}

// Show Notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    // Add to body
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Remove notification after 3 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Initialize settings on page load
document.addEventListener('DOMContentLoaded', () => {
    applyAppearanceSettings();
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    const modal = document.getElementById('settingsModal');
    if (event.target === modal) {
        closeSettings();
    }
});
