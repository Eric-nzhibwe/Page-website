// ============================================================
//  ARTX Authentication — Firebase Auth + Django fallback
//  Firebase Auth handles registration and login on the frontend.
//  After Firebase issues an ID token, we exchange it for a DRF
//  token at /api/auth/firebase-login/ so the rest of the app
//  works unchanged (api-service.js, challenges.js, etc.)
// ============================================================

const API_BASE_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api'
  : `${window.location.origin}/api`;

// ── Firebase app singleton ────────────────────────────────────
let _firebaseApp  = null;
let _firebaseAuth = null;
let _fbReady      = false;   // true once Firebase is initialised

/**
 * Lazy-initialise Firebase using the config served by Django.
 * Falls back to legacy Django auth if Firebase is not configured.
 */
async function initFirebase() {
    if (_fbReady) return true;

    try {
        const res = await fetchWithTimeout(`${API_BASE_URL}/auth/firebase-config/`, {
            headers: getAuthHeaders(),
        }, 8000);

        if (!res.ok) throw new Error('Config endpoint returned ' + res.status);
        const cfg = await res.json();

        // If the server hasn't set the web API key yet, fall back silently
        if (!cfg.apiKey || !cfg.projectId) {
            console.info('Firebase web config not set — using legacy auth.');
            return false;
        }

        // Dynamic import of the Firebase modular SDK (v10 compat CDN)
        const { initializeApp, getApps } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'
        );
        const { getAuth } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
        );

        _firebaseApp  = getApps().length ? getApps()[0] : initializeApp(cfg);
        _firebaseAuth = getAuth(_firebaseApp);
        _fbReady      = true;
        return true;
    } catch (err) {
        console.info('Firebase not available — falling back to legacy auth:', err.message);
        return false;
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('djangoAuthToken');
    return token ? { 'Authorization': `Token ${token}` } : {};
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    runSplash();
    // Pre-warm Firebase in the background so the first login is fast
    initFirebase().catch(() => {});
});

// ── Splash sequence ───────────────────────────────────────────
function runSplash() {
    const splash  = document.getElementById('splashScreen');
    const landing = document.getElementById('landingPage');
    const auth    = document.querySelector('.auth-container');
    if (!splash) return;
    if (landing) { landing.style.opacity = '0'; landing.style.display = 'flex'; }
    if (auth)    { auth.style.opacity    = '0'; auth.style.display    = 'none'; }

    setTimeout(() => {
        splash.style.transition = 'opacity 0.5s ease';
        splash.style.opacity    = '0';
        setTimeout(() => {
            splash.remove();
            if (landing) {
                landing.style.transition = 'opacity 0.55s ease';
                requestAnimationFrame(() => { landing.style.opacity = '1'; });
            }
        }, 500);
    }, 2200);
}

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
    landing.style.transition = 'opacity 0.4s ease';
    landing.style.opacity    = '0';
    setTimeout(() => {
        landing.style.display = 'none';
        auth.style.display    = 'grid';
        auth.style.opacity    = '0';
        auth.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
        auth.style.transform  = 'translateY(14px)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            auth.style.opacity   = '1';
            auth.style.transform = 'translateY(0)';
        }));
    }, 400);
}

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

// ─────────────────────────────────────────────────────────────
//  LOGIN
// ─────────────────────────────────────────────────────────────
async function handleLogin(event) {
    event.preventDefault();
    clearAllErrors();

    const identifier = document.getElementById('loginUsername').value.trim();
    const password   = document.getElementById('loginPassword').value;

    if (!identifier) return showFieldError('loginUsername', 'Please enter your email or username.');
    if (!password)   return showFieldError('loginPassword', 'Please enter your password.');

    const btn = event.target.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Signing in…');

    try {
        // ── Try Firebase Auth first ────────────────────────────────────
        const fbReady = await initFirebase();
        if (fbReady) {
            const result = await _loginWithFirebase(identifier, password);
            if (result.success) {
                _storeSession(result.token, result.user);
                showToast(`Welcome back, ${result.user?.username || 'player'}! 🔥`, 'success');
                setTimeout(() => { window.location.href = '../index.html'; }, 900);
                return;
            }
            // If Firebase returned a specific error (wrong password etc), surface it
            if (result.fatal) {
                showFormError('loginForm', result.message);
                return;
            }
            // Otherwise fall through to legacy auth
        }

        // ── Fallback: legacy Django email/password auth ────────────────
        const res  = await fetchWithTimeout(`${API_BASE_URL}/auth/login/`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username: identifier, password }),
        }, 15000);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            showFormError('loginForm', data.message || data.error || 'Login failed. Please check your credentials.');
            return;
        }

        _storeSession(data.token, data.user);
        showToast(`Welcome back, ${data.user?.username || 'player'}! 🔥`, 'success');
        setTimeout(() => { window.location.href = '../index.html'; }, 900);

    } catch (err) {
        showFormError('loginForm', err.name === 'AbortError'
            ? 'Request timed out. Please check your connection and try again.'
            : 'Could not reach the server. Please try again.');
    } finally {
        setLoading(btn, false, 'Sign In');
    }
}

async function _loginWithFirebase(identifier, password) {
    try {
        const { signInWithEmailAndPassword } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
        );
        // Firebase login requires an email; if identifier looks like a username,
        // we can't use Firebase directly — fall through to legacy auth
        if (!identifier.includes('@')) {
            return { success: false, fatal: false };
        }

        const credential = await signInWithEmailAndPassword(_firebaseAuth, identifier, password);
        const idToken    = await credential.user.getIdToken();

        // Exchange Firebase token for Django DRF token
        return await _exchangeFirebaseToken(idToken);
    } catch (err) {
        const code    = err.code || '';
        const fatal   = ['auth/wrong-password', 'auth/user-not-found',
                         'auth/invalid-credential', 'auth/user-disabled',
                         'auth/too-many-requests'].includes(code);
        const message = _firebaseErrorMessage(code);
        return { success: false, fatal, message };
    }
}

// ─────────────────────────────────────────────────────────────
//  SIGN UP
// ─────────────────────────────────────────────────────────────
async function handleSignup(event) {
    event.preventDefault();
    clearAllErrors();

    const username        = document.getElementById('signupUsername').value.trim();
    const email           = document.getElementById('signupEmail').value.trim();
    const password        = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;

    if (username.length < 3) return showFieldError('signupUsername', 'Username must be at least 3 characters.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return showFieldError('signupEmail', 'Please enter a valid email address.');
    if (password.length < 8)  return showFieldError('signupPassword', 'Password must be at least 8 characters.');
    if (password !== confirmPassword)
        return showFieldError('signupConfirmPassword', 'Passwords do not match.');

    const btn = event.target.querySelector('button[type="submit"]');
    setLoading(btn, true, 'Creating account…');

    try {
        // ── Try Firebase Auth first ────────────────────────────────────
        const fbReady = await initFirebase();
        if (fbReady) {
            const result = await _registerWithFirebase(email, password, username);
            if (result.success) {
                _storeSession(result.token, result.user);
                showToast('Account created! Welcome to ARTX 🎉', 'success');
                setTimeout(() => { window.location.href = '../index.html'; }, 1000);
                return;
            }
            if (result.fatal) {
                showFormError('signupForm', result.message);
                return;
            }
        }

        // ── Fallback: legacy Django registration ───────────────────────
        const res  = await fetchWithTimeout(`${API_BASE_URL}/auth/register/`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ username, email, display_name: username, password, password_confirm: password }),
        }, 15000);
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            let msg = data.message || data.error || 'Registration failed.';
            if (data.details) {
                const msgs = Object.values(data.details).flat();
                if (msgs.length) msg = msgs[0];
                if (data.details.username) showFieldError('signupUsername', data.details.username[0]);
                if (data.details.email)    showFieldError('signupEmail',    data.details.email[0]);
                if (data.details.password) showFieldError('signupPassword', data.details.password[0]);
            }
            showFormError('signupForm', msg);
            return;
        }

        _storeSession(data.token, data.user);
        showToast('Account created! Welcome to ARTX 🎉', 'success');
        setTimeout(() => { window.location.href = '../index.html'; }, 1000);

    } catch (err) {
        showFormError('signupForm', err.name === 'AbortError'
            ? 'Request timed out. Please check your connection and try again.'
            : 'Could not reach the server. Please try again.');
    } finally {
        setLoading(btn, false, 'Create Account');
    }
}

async function _registerWithFirebase(email, password, username) {
    try {
        const { createUserWithEmailAndPassword, updateProfile } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
        );
        const credential = await createUserWithEmailAndPassword(_firebaseAuth, email, password);
        // Store the username as the Firebase display name
        await updateProfile(credential.user, { displayName: username });
        const idToken = await credential.user.getIdToken();

        // Exchange for Django DRF token (this also creates the Django User row)
        const result = await _exchangeFirebaseToken(idToken);

        // If Django user was created, update the username since Firebase only stores displayName
        if (result.success && result.user) {
            await _patchUsername(result.token, username);
            result.user.username = username;
        }

        return result;
    } catch (err) {
        const code    = err.code || '';
        const fatal   = ['auth/email-already-in-use', 'auth/invalid-email',
                         'auth/weak-password', 'auth/operation-not-allowed'].includes(code);
        return { success: false, fatal, message: _firebaseErrorMessage(code) };
    }
}

// ─────────────────────────────────────────────────────────────
//  Shared helpers
// ─────────────────────────────────────────────────────────────

async function _exchangeFirebaseToken(idToken) {
    const res  = await fetchWithTimeout(`${API_BASE_URL}/auth/firebase-login/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firebase_token: idToken }),
    }, 15000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return { success: false, fatal: true, message: data.error || 'Authentication failed.' };
    }
    return { success: true, token: data.token, user: data.user };
}

async function _patchUsername(token, username) {
    try {
        await fetchWithTimeout(`${API_BASE_URL}/auth/profile/`, {
            method:  'PATCH',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Token ${token}`,
            },
            body: JSON.stringify({ username }),
        }, 8000);
    } catch { /* non-fatal */ }
}

function _storeSession(token, user) {
    if (token) {
        localStorage.setItem('djangoAuthToken', token);
        localStorage.setItem('token', token);
    }
    if (user) {
        localStorage.setItem('artxUser', JSON.stringify(user));
        localStorage.setItem('user',     JSON.stringify(user));
    }
}

function _firebaseErrorMessage(code) {
    const map = {
        'auth/wrong-password':       'Incorrect password. Please try again.',
        'auth/user-not-found':       'No account found with that email.',
        'auth/invalid-credential':   'Invalid credentials. Please check your email and password.',
        'auth/email-already-in-use': 'An account with this email already exists. Please sign in instead.',
        'auth/weak-password':        'Password is too weak — use at least 8 characters.',
        'auth/invalid-email':        'Please enter a valid email address.',
        'auth/user-disabled':        'This account has been disabled. Contact support.',
        'auth/too-many-requests':    'Too many failed attempts. Please wait a moment and try again.',
        'auth/operation-not-allowed': 'Email/password sign-in is not enabled. Contact support.',
        'auth/network-request-failed': 'Network error. Please check your connection.',
    };
    return map[code] || 'Authentication failed. Please try again.';
}

// ── UI Helpers ────────────────────────────────────────────────

function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.classList.add('input-error');
    const existing = input.parentElement.querySelector('.field-error-msg');
    if (existing) existing.remove();
    const el = document.createElement('p');
    el.className   = 'field-error-msg';
    el.textContent = message;
    input.parentElement.appendChild(el);
    input.focus();
}

function showFormError(formId, message) {
    const form = document.getElementById(formId);
    if (!form) return;
    let banner = form.querySelector('.form-error-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'form-error-banner';
        form.prepend(banner);
    }
    banner.innerHTML     = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    banner.style.display = 'flex';
}

function clearAllErrors() {
    document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
    document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('.form-error-banner').forEach(el => { el.style.display = 'none'; });
}

function setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
        btn.dataset.originalLabel = btn.querySelector('.btn-auth-text')?.textContent || label;
        const textEl = btn.querySelector('.btn-auth-text');
        if (textEl) textEl.textContent = label;
        else btn.textContent = label;
    } else {
        const textEl = btn.querySelector('.btn-auth-text');
        if (textEl) textEl.textContent = btn.dataset.originalLabel || label;
        else btn.textContent = btn.dataset.originalLabel || label;
    }
}

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
    requestAnimationFrame(() => { toast.classList.add('artx-toast--visible'); });
    setTimeout(() => {
        toast.classList.remove('artx-toast--visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3500);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(tid);
    }
}

// ── Modal helpers ─────────────────────────────────────────────
function openLegalModal(type) {
    const modal = document.getElementById(type === 'privacy' ? 'privacyModal' : 'termsModal');
    if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeLegalModal(type) {
    const modal = document.getElementById(type === 'privacy' ? 'privacyModal' : 'termsModal');
    if (modal) { modal.style.display = 'none'; document.body.style.overflow = ''; }
}
function showAbout()   { const m = document.getElementById('aboutModal');   if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
function showContact() { const m = document.getElementById('contactModal'); if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; } }
function closeInfoModal(type) {
    const ids = { about: 'aboutModal', contact: 'contactModal' };
    const m = document.getElementById(ids[type]);
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}

function handleContactSubmit(event) {
    event.preventDefault();
    showToast('Message sent! We\'ll get back to you within 24-48 hours.', 'success');
    event.target.reset();
}

// ── Globals ───────────────────────────────────────────────────
window.showAuthPage      = showAuthPage;
window.showAbout         = showAbout;
window.showContact       = showContact;
window.openLegalModal    = openLegalModal;
window.closeLegalModal   = closeLegalModal;
window.closeInfoModal    = closeInfoModal;
window.handleContactSubmit = handleContactSubmit;
window.switchToSignup    = switchToSignup;
window.switchToLogin     = switchToLogin;
window.handleLogin       = handleLogin;
window.handleSignup      = handleSignup;
window.togglePassword    = function(fieldId, btn) {
    const field = document.getElementById(fieldId);
    const icon  = btn.querySelector('i');
    const show  = field.type === 'password';
    field.type  = show ? 'text' : 'password';
    icon.classList.toggle('fa-eye',       !show);
    icon.classList.toggle('fa-eye-slash',  show);
};
window.updateStrength = function(val) {
    const bars  = [1,2,3,4].map(n => document.getElementById('sbar' + n));
    const label = document.getElementById('strengthLabel');
    let score = 0;
    if (val.length >= 6)                               score++;
    if (val.length >= 10)                              score++;
    if (/[A-Z]/.test(val) && /[a-z]/.test(val))       score++;
    if (/[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) score++;
    const levels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
    const colors = ['', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];
    bars.forEach((bar, i) => {
        if (!bar) return;
        bar.style.background = i < score ? colors[score] : 'rgba(255,255,255,0.1)';
        bar.style.transform  = i < score ? 'scaleX(1)' : 'scaleX(0.3)';
        bar.style.opacity    = i < score ? '1' : '0.4';
    });
    if (label) {
        label.textContent = val.length ? levels[score] || 'Weak' : 'Strength';
        label.style.color = val.length ? colors[score] : 'rgba(232,232,208,0.35)';
    }
};
