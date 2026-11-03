/**
 * API Service for PAGE Platform
 * Handles all API calls to the Django backend
 */

const API_BASE_URL = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api' : `${window.location.origin}/api`;

class APIService {
    constructor() {
        // Use djangoAuthToken (written by auth.js/otp.js) with authToken as fallback for legacy sessions
        this.token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken') || null;
        this.firebaseToken = localStorage.getItem('firebaseIdToken') || null;
        this.baseURL = API_BASE_URL;
    }

    /**
     * Set authentication token (DRF token)
     */
    setToken(token) {
        this.token = token;
        localStorage.setItem('djangoAuthToken', token);
    }

    /**
     * Set Firebase ID token (for FirebaseToken auth)
     */
    setFirebaseToken(token) {
        this.firebaseToken = token;
        if (token) {
            localStorage.setItem('firebaseIdToken', token);
        } else {
            localStorage.removeItem('firebaseIdToken');
        }
    }

    /**
     * Get authentication headers.
     *
     * Priority:
     *   1. Firebase ID token  → Authorization: FirebaseToken <token>
     *   2. DRF token          → Authorization: Token <token>
     *
     * Firebase token takes priority because it works even when the
     * Django database is unavailable (Render free tier / suspended Postgres).
     */
    getHeaders(includeAuth = true) {
        const headers = {
            'Content-Type': 'application/json',
        };

        if (includeAuth) {
            // Always read the freshest tokens from storage
            this.firebaseToken = localStorage.getItem('firebaseIdToken') || this.firebaseToken;
            this.token = localStorage.getItem('djangoAuthToken')
                      || localStorage.getItem('authToken')
                      || this.token;

            if (this.firebaseToken) {
                headers['Authorization'] = `FirebaseToken ${this.firebaseToken}`;
            } else if (this.token) {
                headers['Authorization'] = `Token ${this.token}`;
            }
        }

        return headers;
    }

    /**
     * Get the best available auth header string.
     */
    _authHeader() {
        this.firebaseToken = localStorage.getItem('firebaseIdToken') || this.firebaseToken;
        this.token = localStorage.getItem('djangoAuthToken')
                  || localStorage.getItem('authToken')
                  || this.token;
        if (this.firebaseToken) return `FirebaseToken ${this.firebaseToken}`;
        if (this.token) return `Token ${this.token}`;
        return null;
    }

    /**
     * Make API request.
     * When options.headers is provided explicitly (e.g. FormData uploads),
     * those headers are used directly so the browser can set the correct
     * multipart boundary automatically.
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;

        // Always read the freshest tokens from storage — the constructor may have
        // run before login completed, and stale null tokens cause silent 401s.
        this.firebaseToken = localStorage.getItem('firebaseIdToken')
                           || this.firebaseToken
                           || null;
        this.token = localStorage.getItem('djangoAuthToken')
                  || localStorage.getItem('authToken')
                  || this.token
                  || null;

        // Build headers first, then spread options so we don't accidentally
        // overwrite the headers we just computed.
        const { headers: optHeaders, ...restOptions } = options;
        const headers = optHeaders !== undefined
            ? optHeaders
            : this.getHeaders(options.auth !== false);

        const config = { headers, ...restOptions };

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                let errorMsg = `HTTP ${response.status}`;
                try {
                    const error = await response.json();
                    errorMsg = error.detail || error.message || errorMsg;
                } catch (_) { /* response had no JSON body */ }
                throw new Error(errorMsg);
            }

            // 204 No Content — nothing to parse
            if (response.status === 204) return null;

            const text = await response.text();
            return text ? JSON.parse(text) : null;
        } catch (error) {
            console.error(`API Error: ${endpoint}`, error);
            throw error;
        }
    }

    /**
     * GET request
     */
    get(endpoint, options = {}) {
        return this.request(endpoint, { method: 'GET', ...options });
    }

    /**
     * POST request
     */
    post(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
            ...options,
        });
    }

    /**
     * PUT request
     */
    put(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(data),
            ...options,
        });
    }

    /**
     * PATCH request
     */
    patch(endpoint, data, options = {}) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(data),
            ...options,
        });
    }

    /**
     * DELETE request
     */
    delete(endpoint, options = {}) {
        return this.request(endpoint, { method: 'DELETE', ...options });
    }

    // ==================== CHALLENGES ====================

    /**
     * Get all active challenges
     */
    getActiveChallenges() {
        return this.get('/challenges/active/', { auth: false });
    }

    getAllChallenges() {
        // Returns standard challenges merged with polls, debates and Q&As
        return this.get('/challenges/all_types/', { auth: false });
    }

    /**
     * Get active challenges created by users the current user follows
     */
    getFollowingChallenges() {
        return this.get('/challenges/following/');
    }

    /**
     * Get all challenges with filters
     */
    getChallenges(filters = {}) {
        const params = new URLSearchParams(filters);
        return this.get(`/challenges/?${params.toString()}`, { auth: false });
    }

    /**
     * Get single challenge
     */
    getChallenge(challengeId) {
        return this.get(`/challenges/${challengeId}/`, { auth: false });
    }

    /**
     * Get challenge leaderboard
     */
    getChallengeLeaderboard(challengeId) {
        return this.get(`/challenges/${challengeId}/leaderboard/`, { auth: false });
    }

    /**
     * Get challenge activity feed
     */
    getChallengeActivity(challengeId) {
        return this.get(`/challenges/${challengeId}/activity/`, { auth: false });
    }

    /**
     * Get challenge statistics
     */
    getChallengeStats(challengeId) {
        return this.get(`/challenges/${challengeId}/stats/`, { auth: false });
    }

    /**
     * Get featured challenges
     */
    getFeaturedChallenges() {
        return this.get('/challenges/featured/', { auth: false });
    }

    // ==================== SUBMISSIONS ====================

    /**
     * Submit to a challenge
     */
    submitChallenge(challengeId, interpretation, submissionTimeSeconds) {
        return this.post('/submissions/', {
            challenge: challengeId,
            interpretation: interpretation,
            submission_time_seconds: submissionTimeSeconds,
        });
    }

    /**
     * Get user's submissions
     */
    getMySubmissions() {
        return this.get('/submissions/my_submissions/');
    }

    /**
     * Get submissions for a challenge
     */
    getChallengeSubmissions(challengeId) {
        return this.get(`/submissions/challenge_submissions/?challenge_id=${challengeId}`, { auth: false });
    }

    /**
     * Get single submission
     */
    getSubmission(submissionId) {
        return this.get(`/submissions/${submissionId}/`);
    }

    // ==================== LEADERBOARDS ====================

    /**
     * Get global leaderboard
     */
    getGlobalLeaderboard() {
        return this.get('/leaderboards/global_leaderboard/', { auth: false });
    }

    // ==================== ACTIVITIES ====================

    /**
     * Get challenge activity
     */
    getActivityFeed(challengeId) {
        return this.get(`/activities/challenge_activity/?challenge_id=${challengeId}`, { auth: false });
    }

    /**
     * Get global activity feed
     */
    getGlobalActivityFeed() {
        return this.get('/activities/global_activity/', { auth: false });
    }

    // ==================== IMAGE INTERPRETATION ====================

    /**
     * Submit an image interpretation attempt
     * @param {string} challengeId
     * @param {Array}  discoveredPoints  [{label, interpretation}]
     * @param {string} overallMessage
     * @param {number} submissionTimeSeconds
     */
    submitImageInterpretation(challengeId, discoveredPoints, overallMessage, submissionTimeSeconds) {
        return this.post('/challenges/image-submissions/', {
            challenge:                challengeId,
            discovered_points:        discoveredPoints,
            overall_message:          overallMessage,
            submission_time_seconds:  submissionTimeSeconds,
        });
    }

    /**
     * Get current user's image interpretation submissions
     */
    getMyImageSubmissions() {
        return this.get('/challenges/image-submissions/my/');
    }

    /**
     * Get leaderboard for an image interpretation challenge
     */
    getImageInterpLeaderboard(challengeId) {
        return this.get(`/challenges/image-submissions/leaderboard/?challenge_id=${challengeId}`, { auth: false });
    }

    // ==================== WALLET ====================

    /**
     * Get wallet balance
     */
    getWallet() {
        return this.get('/payments/wallet/');
    }

    /**
     * Deduct entry fee from wallet
     */
    deductEntryFee(amount, challengeId, description) {
        return this.post('/payments/wallet/deduct/', {
            amount,
            description: description || `Entry fee — challenge ${challengeId}`,
            transaction_type: 'payment',
        });
    }

    // ==================== CHALLENGE CREATION ====================

    /**
     * Create a new challenge with image upload (multipart/form-data).
     */
    createChallenge(formData) {
        const auth = this._authHeader();
        return this.request('/challenges/', {
            method: 'POST',
            body: formData,
            headers: auth ? { 'Authorization': auth } : {},
        });
    }

    /**
     * Publish (activate) a draft challenge. Only the creator can do this.
     */
    publishChallenge(challengeId) {
        const auth = this._authHeader();
        return this.request(`/challenges/${challengeId}/publish/`, {
            method: 'POST',
            headers: auth ? { 'Authorization': auth, 'Content-Type': 'application/json' } : {},
        });
    }

    /**
     * Unpublish (pause) an active challenge. Only the creator can do this.
     */
    unpublishChallenge(challengeId) {
        const auth = this._authHeader();
        return this.request(`/challenges/${challengeId}/unpublish/`, {
            method: 'POST',
            headers: auth ? { 'Authorization': auth, 'Content-Type': 'application/json' } : {},
        });
    }

    /**
     * Permanently delete a challenge. Only the creator can do this.
     */
    deleteChallenge(challengeId) {
        const auth = this._authHeader();
        return this.request(`/challenges/${challengeId}/`, {
            method: 'DELETE',
            headers: auth ? { 'Authorization': auth } : {},
        });
    }

    /**
     * Delete a social challenge (poll / debate / Q&A) by type and ID.
     * type: 'polls' | 'debates' | 'qa'
     */
    deleteSocialChallenge(type, challengeId) {
        const auth = this._authHeader();
        return this.request(`/challenges/${type}/${challengeId}/delete/`, {
            method: 'DELETE',
            headers: auth ? { 'Authorization': auth } : {},
        });
    }

    /**
     * Get all challenges created by the current user (drafts + active + paused).
     */
    getMyChallenges() {
        return this.get('/challenges/my_challenges/');
    }

    // ==================== CONTENT UPLOAD ====================

    /**
     * Upload user content for community review (multipart/form-data).
     */
    uploadContent(formData) {
        const auth = this._authHeader();
        return this.request('/social/posts/', {
            method: 'POST',
            body: formData,
            headers: auth ? { 'Authorization': auth } : {},
        });
    }
}

// Create global instance
const apiService = new APIService();

// ── Proactive Firebase token refresh ─────────────────────────────────────────
// Firebase ID tokens expire after 60 minutes. This interval fires every
// 50 minutes and forces a token refresh so the stored token never goes stale
// during an active session. Works alongside the boot-time check in app.js.
(function _startFirebaseTokenRefreshInterval() {
    const REFRESH_INTERVAL_MS = 50 * 60 * 1000; // 50 minutes

    async function _doRefresh() {
        // Only run if the user has a Firebase token — DRF token users don't need this.
        const stored = localStorage.getItem('firebaseIdToken');
        if (!stored) return;

        try {
            const [appModule, authModule] = await Promise.all([
                import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js').catch(() => ({})),
                import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').catch(() => ({})),
            ]);

            const { getAuth } = authModule || {};
            const { getApps, initializeApp } = appModule || {};
            if (!getAuth || !getApps) return;

            let auth;
            if (getApps().length === 0) {
                try {
                    const cfgRes = await fetch(`${API_BASE_URL}/users/firebase-config/`);
                    if (cfgRes.ok) {
                        const cfg = await cfgRes.json();
                        if (cfg.apiKey && cfg.projectId) {
                            auth = getAuth(initializeApp(cfg));
                        }
                    }
                } catch (_) { return; }
            } else {
                auth = getAuth();
            }

            if (!auth) return;
            if (auth.authStateReady) await auth.authStateReady();

            const user = auth.currentUser;
            if (user) {
                // forceRefresh=true — always get a new token on the interval tick
                const fresh = await user.getIdToken(true);
                if (fresh) {
                    localStorage.setItem('firebaseIdToken', fresh);
                    console.info('[PAGE] Firebase token refreshed (interval).');
                }
            }
        } catch (_) {
            // Non-fatal — the expiry-check in _pageAuthHeader will catch it
        }
    }

    setInterval(_doRefresh, REFRESH_INTERVAL_MS);
})();

// ── Global auth helpers — usable by any script on the page ──────────────────

/**
 * Synchronous header builder — returns whatever token is in localStorage.
 * Safe for non-critical reads (e.g. GET requests that degrade gracefully).
 * For write/mutation requests use the async _pageAuthHeaderAsync() below
 * so expired Firebase tokens are refreshed before the call is made.
 *
 * Skips an expired Firebase token and falls through to the DRF token so a
 * stale token (e.g. after an hour-long idle session) never causes a 401.
 */
window._pageAuthHeader = function () {
    const fbToken = localStorage.getItem('firebaseIdToken');
    if (fbToken) {
        // Cheap expiry check — decode JWT payload without a network call.
        // If the token is expired, skip it so the DRF token is used instead.
        try {
            const payload = JSON.parse(atob(fbToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            if (Date.now() < payload.exp * 1000) {
                return `FirebaseToken ${fbToken}`;
            }
            // Token is expired — fall through to DRF token
        } catch (_) {
            // Malformed token — fall through to DRF token
        }
    }
    const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    if (token) return `Token ${token}`;
    return null;
};

/**
 * Async header builder — refreshes an expired Firebase ID token before
 * returning the header value.  Always use this for POST/PATCH/PUT/DELETE
 * requests so 401s from stale tokens don't silently drop writes.
 *
 * Falls back gracefully:
 *   • Firebase active  → refresh token if <5 min left, return FirebaseToken
 *   • Firebase inactive / user not signed in → return Token <drfToken>
 *   • No token at all  → return null
 *
 * @returns {Promise<string|null>}
 */
window._pageAuthHeaderAsync = async function () {
    // ── 1. Try refreshing via Firebase SDK ────────────────────────────────
    try {
        const [appModule, authModule] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js').catch(() => ({})),
            import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js').catch(() => ({})),
        ]);

        const { getAuth, initializeAuth, browserLocalPersistence } = authModule || {};
        const { getApps, initializeApp } = appModule || {};

        if (getAuth && getApps) {
            let auth;

            // If no Firebase app is initialized yet on this page, initialize one.
            // This covers all non-auth.html pages (index, user, challenge, etc.)
            // where auth.js never ran but we still need token refresh.
            if (getApps().length === 0) {
                // Fetch config from backend (public endpoint, no auth required)
                try {
                    const cfgRes = await fetch(`${API_BASE_URL}/users/firebase-config/`);
                    if (cfgRes.ok) {
                        const cfg = await cfgRes.json();
                        if (cfg.apiKey && cfg.projectId) {
                            const app = initializeApp(cfg);
                            auth = getAuth(app);
                        }
                    }
                } catch (_) { /* network unavailable — fall through */ }
            } else {
                auth = getAuth();
            }

            if (auth) {
                // Wait for the SDK to restore the persisted session from IndexedDB.
                // authStateReady() resolves once currentUser is settled (null or User).
                if (auth.authStateReady) {
                    await auth.authStateReady();
                }

                const user = auth.currentUser;
                if (user) {
                    // forceRefresh=false: SDK returns cached token if still valid,
                    // fetches a new one silently if expired.
                    const freshToken = await user.getIdToken(false);
                    if (freshToken) {
                        localStorage.setItem('firebaseIdToken', freshToken);
                        return `FirebaseToken ${freshToken}`;
                    }
                }
            }
        }
    } catch (_) {
        // Firebase SDK unavailable or user not signed in — fall through
    }

    // ── 2. Fall back to whatever is in localStorage (expiry-checked) ──────
    return window._pageAuthHeader();
};

// Returns true if the user has any auth token stored.
window._pageIsAuthed = function () {
    return !!(localStorage.getItem('firebaseIdToken')
           || localStorage.getItem('djangoAuthToken')
           || localStorage.getItem('authToken'));
};

// Logout helper — clears all stored tokens and redirects to auth page.
window._pageLogout = async function () {
    // ── 1. Sign out of Firebase so the SDK doesn't auto-restore the session ──
    // This is the critical step for Firebase users — without it the SDK still
    // holds an authenticated state in memory and IndexedDB, which means
    // _pageIsAuthed() returns true again on the next page load.
    try {
        const { getAuth, signOut } = await import(
            'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'
        );
        const auth = getAuth();
        if (auth.currentUser) await signOut(auth);
    } catch (_) {
        // Firebase not initialised on this page — safe to ignore
    }

    // ── 2. Wipe every auth key from localStorage ──────────────────────────────
    const AUTH_KEYS = [
        'djangoAuthToken', 'authToken', 'token',
        'firebaseIdToken',
        'pageUser', 'user', 'userId',
        'authSource',
    ];
    AUTH_KEYS.forEach(k => localStorage.removeItem(k));

    // ── 3. Use an absolute path so this works from any page depth ────────────
    window.location.href = '/pages/auth.html';
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIService;
}
