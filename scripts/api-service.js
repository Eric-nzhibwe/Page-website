/**
 * API Service for ARTX Platform
 * Handles all API calls to the Django backend
 */

const API_BASE_URL = 'http://localhost:8000/api';

class APIService {
    constructor() {
        this.token = localStorage.getItem('authToken');
        this.baseURL = API_BASE_URL;
    }

    /**
     * Set authentication token
     */
    setToken(token) {
        this.token = token;
        localStorage.setItem('authToken', token);
    }

    /**
     * Get authentication headers
     */
    getHeaders(includeAuth = true) {
        const headers = {
            'Content-Type': 'application/json',
        };

        if (includeAuth && this.token) {
            headers['Authorization'] = `Token ${this.token}`;
        }

        return headers;
    }

    /**
     * Make API request
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: this.getHeaders(options.auth !== false),
            ...options,
        };

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || error.message || `HTTP ${response.status}`);
            }

            return await response.json();
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
}

// Create global instance
const apiService = new APIService();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = APIService;
}
