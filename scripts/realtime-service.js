/**
 * Real-time Service for ARTX Platform
 * Handles polling-based updates (WebSocket not configured)
 * 
 * NOTE: WebSocket support is not yet implemented. Using polling instead.
 * To enable WebSocket, install django-channels and configure routing.
 */

class RealtimeService {
    constructor() {
        this.ws = null;
        // WebSocket URL removed - using polling instead
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.listeners = {};
        this.isConnected = false;
        this.pollInterval = null;
        this.pollDelay = 5000; // Poll every 5 seconds
    }

    /**
     * Connect using polling instead of WebSocket
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                console.warn('⚠️ WebSocket not configured. Using polling instead.');
                console.log('💡 To enable WebSocket: pip install django-channels');
                
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.emit('connected');
                
                // Start polling
                this.startPolling();
                
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Start polling for updates
     */
    startPolling() {
        if (this.pollInterval) return; // Already polling
        
        console.log('📡 Starting polling for challenge updates');
        
        this.pollInterval = setInterval(() => {
            this.emit('poll_update');
        }, this.pollDelay);
    }

    /**
     * Stop polling
     */
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Attempt to reconnect (polling-based)
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
     * Disconnect (polling-based, no WebSocket to close)
     */
    disconnect() {
        this.stopPolling();
    }
}

// Create global instance
const realtimeService = new RealtimeService();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RealtimeService;
}
