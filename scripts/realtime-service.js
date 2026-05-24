/**
 * Real-time Service for ARTX Platform
 * Handles WebSocket connections for live updates
 */

class RealtimeService {
    constructor() {
        this.ws = null;
        this.url = 'ws://localhost:8000/ws/challenges/';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.listeners = {};
        this.isConnected = false;
    }

    /**
     * Connect to WebSocket
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    console.log('WebSocket connected');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.emit('connected');
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.emit('error', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('WebSocket disconnected');
                    this.isConnected = false;
                    this.emit('disconnected');
                    this.attemptReconnect();
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Attempt to reconnect
     */
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => this.connect().catch(console.error), this.reconnectDelay);
        } else {
            console.error('Max reconnection attempts reached');
            this.emit('reconnect_failed');
        }
    }

    /**
     * Handle incoming WebSocket message
     */
    handleMessage(data) {
        const { type, payload } = data;

        switch (type) {
            case 'submission':
                this.emit('new_submission', payload);
                break;
            case 'score_update':
                this.emit('score_update', payload);
                break;
            case 'leaderboard_update':
                this.emit('leaderboard_update', payload);
                break;
            case 'activity':
                this.emit('activity', payload);
                break;
            case 'countdown':
                this.emit('countdown', payload);
                break;
            default:
                console.warn('Unknown message type:', type);
        }
    }

    /**
     * Subscribe to challenge updates
     */
    subscribeToChallengeUpdates(challengeId) {
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                action: 'subscribe',
                challenge_id: challengeId,
            }));
        }
    }

    /**
     * Unsubscribe from challenge updates
     */
    unsubscribeFromChallengeUpdates(challengeId) {
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify({
                action: 'unsubscribe',
                challenge_id: challengeId,
            }));
        }
    }

    /**
     * Register event listener
     */
    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    /**
     * Unregister event listener
     */
    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    /**
     * Emit event
     */
    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for ${event}:`, error);
                }
            });
        }
    }

    /**
     * Disconnect WebSocket
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Create global instance
const realtimeService = new RealtimeService();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RealtimeService;
}
