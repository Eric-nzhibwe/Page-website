// ============================================================
//  ARTX Authentication — clean, professional, no alert() popups
// ============================================================

const API_BASE_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api'
  : `${window.location.origin}/api`;

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();

    setTimeout(() => {
        const splash = document.getElementById('splashScreen');
        if (splash) splash.remove();
    }, 2200);
});

// ── Already logged in? Skip the auth page ────────────────────
async function checkAuthStatus() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return;

    try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/auth/profile/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (res.ok) {
            window.location.href = '../index.html';
        } else {
            localStorage.removeItem('djangoAuthToken');
        }
    } catch {
        localStorage.removeItem('djangoAuthToken');
    }
}

// ── Landing → Auth transition ─────────────────────────────────
function showAuthPage() {
    const landing = document.getElementById('landingPage');
    const auth    = document.querySelector('.auth-container');
    if (!landing || !auth) return;

    landing.style.transition = 'opacity .45s ease';
    landing.style.opacity    = '0';
    setTimeout(() => {
        landing.style.display = 'none';
        auth.style.display    = 'grid';
        // Animate in
        auth.style.opacity    = '0';
        auth.style.transition = 'opacity .4s ease';
        requestAnimationFrame(() => { auth.style.opacity = '1'; });
    }, 450);
}

function showAbout()   { showToast('About page — coming soon!', 'info'); }
function showContact() { showToast('Contact page — coming soon!', 'info'); }

// ── Switch between Login / Sign Up ───────────────────────────
function switchToSignup() {
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('signupForm').classList.add('active');
    clearAllErrors();
}

function switchToLogin() {
    document.getElementById('signupForm').classList.remove('active');
    document.getElementById('loginForm').classList.add('active');
    clearAllErrors();
}

// ── LOGIN ─────────────────────────────────────────────────────
async function handleLogin(event) {
    event.preventDefault();
    clearAllErrors();

    const identifier = document.getElementById('loginUsername').value.trim();
    const password   = document.getElementById('loginPassword').value;

    // Client-side validation
    if (!identifier) {
        return showFieldError('loginUsername', 'Please enter your email or username.');
    }
    if (!password) {
        return showFieldError('loginPassword', 'Please enter your password.');
    }

    const btn = event.target.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Signing in…');

    try {
        const res  = await fetchWithTimeout(`${API_BASE_URL}/auth/login/`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username: identifier, password })
        }, 15000);

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data.message || data.error || 'Login failed. Please check your credentials.';
            showFormError('loginForm', msg);
            return;
        }

        // ── Success ──
        if (data.token) {
            localStorage.setItem('djangoAuthToken', data.token);
        }
        if (data.user) {
            localStorage.setItem('artxUser', JSON.stringify(data.user));
        }

        showToast(`Welcome back, ${data.user?.username || 'player'}! 🔥`, 'success');

        // Short delay so toast is visible, then redirect
        setTimeout(() => { window.location.href = '../index.html'; }, 900);

    } catch (err) {
        const isTimeout = err.name === 'AbortError';
        showFormError('loginForm', isTimeout
            ? 'Request timed out. Please check your connection and try again.'
            : 'Could not reach the server. Please try again.');
    } finally {
        setLoading(btn, false, 'Sign In');
    }
}

// ── SIGN UP ───────────────────────────────────────────────────
async function handleSignup(event) {
    event.preventDefault();
    clearAllErrors();

    const username        = document.getElementById('signupUsername').value.trim();
    const email           = document.getElementById('signupEmail').value.trim();
    const password        = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;

    // Client-side validation
    if (username.length < 3) {
        return showFieldError('signupUsername', 'Username must be at least 3 characters.');
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return showFieldError('signupEmail', 'Please enter a valid email address.');
    }
    if (password.length < 6) {
        return showFieldError('signupPassword', 'Password must be at least 6 characters.');
    }
    if (password !== confirmPassword) {
        return showFieldError('signupConfirmPassword', 'Passwords do not match.');
    }

    const btn = event.target.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Creating account…');

    try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/auth/register/`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                username,
                email,
                display_name: username,
                password,
                password_confirm: password
            })
        }, 15000);

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            let msg = data.message || data.error || 'Registration failed.';
            if (data.details) {
                if (data.details.username) msg = 'That username is already taken.';
                else if (data.details.email) msg = 'That email is already registered.';
            }
            showFormError('signupForm', msg);
            return;
        }

        // ── Success ──
        if (data.token) localStorage.setItem('djangoAuthToken', data.token);
        if (data.user)  localStorage.setItem('artxUser', JSON.stringify(data.user));

        showToast('Account created! Welcome to ARTX 🎉', 'success');
        setTimeout(() => { window.location.href = '../index.html'; }, 1000);

    } catch (err) {
        const isTimeout = err.name === 'AbortError';
        showFormError('signupForm', isTimeout
            ? 'Request timed out. Please check your connection and try again.'
            : 'Could not reach the server. Please try again.');
    } finally {
        setLoading(btn, false, 'Sign Up');
    }
}

// ── UI Helpers ────────────────────────────────────────────────

/** Show an error message below a specific input field */
function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.classList.add('input-error');

    // Remove any existing error for this field
    const existing = input.parentElement.querySelector('.field-error-msg');
    if (existing) existing.remove();

    const el = document.createElement('p');
    el.className   = 'field-error-msg';
    el.textContent = message;
    input.parentElement.appendChild(el);
    input.focus();
}

/** Show a banner error at the top of a form */
function showFormError(formId, message) {
    const form = document.getElementById(formId);
    if (!form) return;

    let banner = form.querySelector('.form-error-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'form-error-banner';
        form.prepend(banner);
    }
    banner.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    banner.style.display = 'flex';
}

/** Remove all inline errors */
function clearAllErrors() {
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.form-error-banner').forEach(el => { el.style.display = 'none'; });
}

/** Toggle button loading state */
function setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled     = loading;
    btn.textContent  = loading ? label : (btn.dataset.originalLabel || label);
    if (!loading) btn.dataset.originalLabel = label;
}

/** Non-blocking toast notification */
function showToast(message, type = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `artx-toast artx-toast--${type}`;

    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => { toast.classList.add('artx-toast--visible'); });

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.remove('artx-toast--visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3500);
}

// ── Network Helper ────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(tid);
    }
}

// ── Globals ───────────────────────────────────────────────────
window.showAuthPage    = showAuthPage;
window.showAbout       = showAbout;
window.showContact     = showContact;
window.switchToSignup  = switchToSignup;
window.switchToLogin   = switchToLogin;
window.handleLogin     = handleLogin;
window.handleSignup    = handleSignup;
