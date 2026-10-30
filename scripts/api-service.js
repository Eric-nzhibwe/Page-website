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

// ── Global auth helpers — usable by any script on the page ──────────────────
// Returns the best available Authorization header value (Firebase token first,
// DRF token fallback) or null when no token is stored.
window._pageAuthHeader = function () {
    const fbToken = localStorage.getItem('firebaseIdToken');
    if (fbToken) return `FirebaseToken ${fbToken}`;
    const token = localStorage.getItem('djangoAuthToken') || localStorage.getItem('authToken');
    if (token) return `Token ${token}`;
    return null;
};

// Returns true if the user has any auth token stored.
window._pageIsAuthed = function () {
    return !!(localStorage.getItem('firebaseIdToken')
           || localStorage.getItem('djangoAuthToken')
           || localStorage.getItem('authToken'));
};

// Logout helper — clears all stored tokens and redirects to auth page.
window._pageLogout = function () {
    localStorage.removeItem('djangoAuthToken');
    localStorage.removeItem('authToken');
    localStorage.removeItem('token');
    localStorage.removeItem('firebaseIdToken');
    localStorage.removeItem('pageUser');
    localStorage.removeItem('user');
    localStorage.removeItem('authSource');
    window.location.href = 'pages/auth.html';
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIService;
}
