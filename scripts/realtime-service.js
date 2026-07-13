/**
 * Real-time Service for ARTX Platform
 *
 * Connects via WebSocket (django-channels) when available,
 * falls back to HTTP polling if the connection fails.
 *
 * Usage
 * ─────
 * realtimeService.connect()
 * realtimeService.subscribeToChallengeUpdates(challengeId)
 * realtimeService.on('new_submission',    handler)
 * realtimeService.on('leaderboard_update', handler)
 * realtimeService.on('activity',           handler)
 * realtimeService.unsubscribeFromChallengeUpdates(challengeId)
 */

class RealtimeService {
    constructor() {
        this.ws              = null;
        this.isConnected     = false;
        this.reconnectAttempts    = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay  = 3000;   // ms between reconnect attempts
        this.listeners       = {};

        // Polling fallback
        this.pollInterval    = null;
        this.pollDelay       = 5000;   // ms between polls
        this.usingPolling    = false;

        // Track which challenge we're currently subscribed to
        this.subscribedChallengeId = null;
    }

    // ── WebSocket URL ────────────────────────────────────────────────────────

    _wsBase() {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${window.location.host}`;
    }

    _challengeWsUrl(challengeId) {
        return `${this._wsBase()}/ws/challenges/${challengeId}/`;
    }

    // ── Connection ───────────────────────────────────────────────────────────

    /**
     * Connect to the challenge WebSocket.
     * Falls back to polling if the connection cannot be established.
     * @param {string} challengeId
     * @returns {Promise<void>}
     */
    connect(challengeId) {
        // If already connected to this challenge, do nothing
        if (this.isConnected && this.subscribedChallengeId === challengeId) {
            return Promise.resolve();
        }

        // Close any existing connection first
        this._closeWs();

        if (!challengeId) {
            // No challenge yet — start generic polling
            this._startPolling();
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            try {
                const url = this._challengeWsUrl(challengeId);
                this.ws = new WebSocket(url);

                const connectTimeout = setTimeout(() => {
                    // If WebSocket hasn't opened within 4 s, use polling
                    if (!this.isConnected) {
                        console.warn('⚠️ WebSocket timeout — falling back to polling');
                        this._closeWs();
                        this._startPolling();
                        resolve();
                    }
                }, 4000);

                this.ws.onopen = () => {
                    clearTimeout(connectTimeout);
                    this.isConnected   = true;
                    this.usingPolling  = false;
                    this.reconnectAttempts = 0;
                    this.subscribedChallengeId = challengeId;
                    console.log(`✅ WebSocket connected → challenge ${challengeId}`);
                    this.emit('connected');
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        this._handleMessage(JSON.parse(event.data));
                    } catch (e) {
                        console.warn('WS message parse error', e);
                    }
                };

                this.ws.onerror = (err) => {
                    clearTimeout(connectTimeout);
                    console.warn('WebSocket error — using polling fallback', err);
                    this._closeWs();
                    this._startPolling();
                    resolve();
                };

                this.ws.onclose = (ev) => {
                    if (this.isConnected) {
                        console.log('WebSocket closed, attempting reconnect…');
                        this.isConnected = false;
                        this._attemptReconnect(challengeId);
                    }
                };
            } catch (err) {
                console.warn('WebSocket not supported — using polling', err);
                this._startPolling();
                resolve();
            }
        });
    }

    // ── Message handling ─────────────────────────────────────────────────────

    _handleMessage(data) {
        const { type, payload } = data;
        switch (type) {
            case 'new_submission':
            case 'submission':
                this.emit('new_submission', payload);
                break;
            case 'leaderboard_update':
                this.emit('leaderboard_update', payload);
                break;
            case 'activity':
                this.emit('activity', payload);
                break;
            case 'challenge.update':
                this.emit('challenge_update', payload);
                break;
            case 'score_update':
                this.emit('score_update', payload);
                break;
            case 'pong':
                break;
            default:
                console.debug('Unknown WS message type:', type);
        }
    }

    // ── Subscription helpers ─────────────────────────────────────────────────

    subscribeToChallengeUpdates(challengeId) {
        if (challengeId === this.subscribedChallengeId && this.isConnected) return;
        this.connect(challengeId);
    }

    unsubscribeFromChallengeUpdates(challengeId) {
        if (this.subscribedChallengeId === challengeId) {
            this._closeWs();
            this._stopPolling();
            this.subscribedChallengeId = null;
        }
    }

    // ── Polling fallback ─────────────────────────────────────────────────────

    _startPolling() {
        if (this.pollInterval) return;
        this.usingPolling = true;
        console.log('📡 Real-time polling active (5 s interval)');
        this.pollInterval = setInterval(() => this.emit('poll_update'), this.pollDelay);
    }

    _stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.usingPolling = false;
    }

    // ── Reconnection ─────────────────────────────────────────────────────────

    _attemptReconnect(challengeId) {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn('Max WS reconnect attempts reached — switching to polling');
            this._startPolling();
            return;
        }
        this.reconnectAttempts++;
        console.log(`Reconnecting… attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        setTimeout(() => this.connect(challengeId), this.reconnectDelay);
    }

    // ── Utilities ────────────────────────────────────────────────────────────

    _closeWs() {
        if (this.ws) {
            this.ws.onclose = null; // prevent re-trigger
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }

    disconnect() {
        this._closeWs();
        this._stopPolling();
        this.subscribedChallengeId = null;
    }

    /** Send a raw message (only when WS is live) */
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    /** Keep-alive ping */
    ping() { this.send({ action: 'ping' }); }

    // ── Event emitter ─────────────────────────────────────────────────────────

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    emit(event, data) {
        (this.listeners[event] || []).forEach(cb => {
            try { cb(data); } catch (e) { console.error(`Listener error [${event}]`, e); }
        });
    }
}

// Global singleton
const realtimeService = new RealtimeService();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = RealtimeService;
}
