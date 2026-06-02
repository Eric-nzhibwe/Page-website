/**
 * WebSocket Client for Real-time Social Features
 * Handles connections for posts, comments, reactions, shares, and stories
 */

class ARTXWebSocketClient {
    constructor() {
        this.connections = new Map(); // Store WebSocket connections
        this.reconnectAttempts = 3;
        this.reconnectDelay = 3000;
    }

    /**
     * Get WebSocket URL based on environment
     */
    getWebSocketURL(endpoint) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws/social/${endpoint}`;
    }

    /**
     * Connect to post-specific WebSocket for real-time updates
     * @param {string} postId - The post ID to connect to
     * @param {object} callbacks - Event callbacks (onComment, onReaction, onShare, onError)
     * @returns {WebSocket} The WebSocket connection
     */
    connectToPost(postId, callbacks = {}) {
        const connectionKey = `post_${postId}`;
        
        // Close existing connection if any
        if (this.connections.has(connectionKey)) {
            this.connections.get(connectionKey).close();
        }

        const wsUrl = this.getWebSocketURL(`posts/${postId}/`);
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log(`Connected to post ${postId} WebSocket`);
            if (callbacks.onConnect) callbacks.onConnect();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'comment_created':
                        if (callbacks.onComment) callbacks.onComment(data.comment);
                        break;
                    case 'reaction_updated':
                        if (callbacks.onReaction) callbacks.onReaction(data.reaction);
                        break;
                    case 'post_shared':
                        if (callbacks.onShare) callbacks.onShare(data.share);
                        break;
                    default:
                        console.log('Unknown message type:', data.type);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                if (callbacks.onError) callbacks.onError(error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (callbacks.onError) callbacks.onError(error);
        };

        ws.onclose = () => {
            console.log(`Disconnected from post ${postId} WebSocket`);
            this.connections.delete(connectionKey);
            if (callbacks.onDisconnect) callbacks.onDisconnect();
        };

        this.connections.set(connectionKey, ws);
        return ws;
    }

    /**
     * Connect to stories WebSocket for real-time story updates
     * @param {object} callbacks - Event callbacks (onView, onCreate, onError)
     * @returns {WebSocket} The WebSocket connection
     */
    connectToStories(callbacks = {}) {
        const connectionKey = 'stories';
        
        // Close existing connection if any
        if (this.connections.has(connectionKey)) {
            this.connections.get(connectionKey).close();
        }

        const wsUrl = this.getWebSocketURL('stories/');
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('Connected to stories WebSocket');
            if (callbacks.onConnect) callbacks.onConnect();
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                switch (data.type) {
                    case 'story_viewed':
                        if (callbacks.onView) callbacks.onView(data.view, data.story_id);
                        break;
                    case 'story_created':
                        if (callbacks.onCreate) callbacks.onCreate(data.story);
                        break;
                    default:
                        console.log('Unknown message type:', data.type);
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
                if (callbacks.onError) callbacks.onError(error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            if (callbacks.onError) callbacks.onError(error);
        };

        ws.onclose = () => {
            console.log('Disconnected from stories WebSocket');
            this.connections.delete(connectionKey);
            if (callbacks.onDisconnect) callbacks.onDisconnect();
        };

        this.connections.set(connectionKey, ws);
        return ws;
    }

    /**
     * Send a comment via WebSocket
     * @param {string} postId - The post ID
     * @param {string} content - The comment content
     */
    sendComment(postId, content) {
        const connectionKey = `post_${postId}`;
        const ws = this.connections.get(connectionKey);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'comment',
                content: content
            }));
        } else {
            console.error('WebSocket not connected for post:', postId);
        }
    }

    /**
     * Send a reaction via WebSocket
     * @param {string} postId - The post ID
     * @param {string} reactionType - The reaction type (fire, like, love, wow, sad)
     */
    sendReaction(postId, reactionType = 'fire') {
        const connectionKey = `post_${postId}`;
        const ws = this.connections.get(connectionKey);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'react',
                reaction_type: reactionType
            }));
        } else {
            console.error('WebSocket not connected for post:', postId);
        }
    }

    /**
     * Send a share via WebSocket
     * @param {string} postId - The post ID
     * @param {string} platform - The platform (facebook, whatsapp, x, copy_link)
     */
    sendShare(postId, platform) {
        const connectionKey = `post_${postId}`;
        const ws = this.connections.get(connectionKey);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'share',
                platform: platform
            }));
        } else {
            console.error('WebSocket not connected for post:', postId);
        }
    }

    /**
     * Send a story view via WebSocket
     * @param {string} storyId - The story ID
     */
    sendStoryView(storyId) {
        const connectionKey = 'stories';
        const ws = this.connections.get(connectionKey);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'view',
                story_id: storyId
            }));
        } else {
            console.error('WebSocket not connected for stories');
        }
    }

    /**
     * Send a story creation via WebSocket
     * @param {string} mediaUrl - The media URL
     * @param {string} mediaType - The media type (image, video)
     * @param {string} content - The story content
     */
    sendStoryCreate(mediaUrl, mediaType = 'image', content = '') {
        const connectionKey = 'stories';
        const ws = this.connections.get(connectionKey);
        
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                action: 'create',
                media_url: mediaUrl,
                media_type: mediaType,
                content: content
            }));
        } else {
            console.error('WebSocket not connected for stories');
        }
    }

    /**
     * Disconnect from a specific connection
     * @param {string} connectionKey - The connection key (e.g., 'post_123' or 'stories')
     */
    disconnect(connectionKey) {
        const ws = this.connections.get(connectionKey);
        if (ws) {
            ws.close();
            this.connections.delete(connectionKey);
        }
    }

    /**
     * Disconnect all WebSocket connections
     */
    disconnectAll() {
        this.connections.forEach((ws, key) => {
            ws.close();
        });
        this.connections.clear();
    }
}

// Create global instance
const wsClient = new ARTXWebSocketClient();
