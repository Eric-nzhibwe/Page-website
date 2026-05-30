/**
 * Real-time Updates System
 * - Polling-based updates for live feed, stories, and user activity
 * - Real-time notifications via polling
 * - Online user tracking
 * 
 * NOTE: WebSocket support is not yet implemented. Using polling instead.
 * To enable WebSocket, install django-channels and configure routing.
 */

// API Base URL - Dynamic detection for production
const API_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

class RealtimeUpdates {
    constructor() {
        this.feedSocket = null;
        this.notificationSocket = null;
        this.onlineUsers = new Map();
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.pollInterval = null;
        this.notificationPollInterval = null;
        this.pollDelay = 5000; // Poll every 5 seconds
    }
    
    /**
     * Initialize polling-based updates
     */
    init() {
        console.log('🔄 Initializing real-time updates (polling mode)');
        this.startPolling();
        
        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.stopPolling();
            } else {
                this.startPolling();
            }
        });
    }
    
    /**
     * Start polling for feed updates
     */
    startPolling() {
        if (this.pollInterval) return; // Already polling
        
        console.log('📡 Starting polling for feed updates');
        this.isConnected = true;
        
        // Initial fetch
        this.requestFeedUpdate();
        this.requestNotificationUpdate();
        
        // Poll every 5 seconds
        this.pollInterval = setInterval(() => {
            this.requestFeedUpdate();
        }, this.pollDelay);
        
        this.notificationPollInterval = setInterval(() => {
            this.requestNotificationUpdate();
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
        if (this.notificationPollInterval) {
            clearInterval(this.notificationPollInterval);
            this.notificationPollInterval = null;
        }
        this.isConnected = false;
        console.log('⏸️ Stopped polling');
    }
    
    /**
     * Connect to social feed WebSocket (deprecated - using polling instead)
     */
    connectFeedSocket() {
        console.warn('⚠️ WebSocket not configured. Using polling instead.');
        console.log('💡 To enable WebSocket: pip install django-channels');
        // WebSocket not available - using polling instead
    }
    
    /**
     * Connect to notifications WebSocket (deprecated - using polling instead)
     */
    connectNotificationSocket() {
        console.warn('⚠️ WebSocket not configured. Using polling instead.');
        // WebSocket not available - using polling instead
    }
    
    /**
     * Handle feed messages
     */
    handleFeedMessage(data) {
        const { type } = data;
        
        switch (type) {
            case 'feed_update':
                this.updateFeed(data.posts);
                break;
            case 'stories_update':
                this.updateStories(data.stories);
                break;
            case 'online_users':
                this.updateOnlineUsers(data.users);
                break;
            case 'post_created':
                this.addNewPost(data.post);
                break;
            case 'post_updated':
                this.updatePost(data.post);
                break;
            case 'comment_created':
                this.addNewComment(data.comment, data.post_id);
                break;
            case 'user_followed':
                this.handleUserFollowed(data.follower, data.following);
                break;
            case 'user_online':
                this.handleUserOnline(data.user);
                break;
            case 'user_offline':
                this.handleUserOffline(data.user_id);
                break;
            case 'error':
                console.error('Feed error:', data.message);
                break;
        }
    }
    
    /**
     * Handle notification messages
     */
    handleNotificationMessage(data) {
        const { type } = data;
        
        switch (type) {
            case 'notification':
                this.showNotification(data.title, data.message, data.icon);
                break;
            case 'follow_notification':
                this.showFollowNotification(data);
                break;
            case 'comment_notification':
                this.showCommentNotification(data);
                break;
        }
    }
    
    /**
     * Update feed with new posts
     */
    updateFeed(posts) {
        const feedContainer = document.getElementById('feedPosts');
        if (!feedContainer) return;
        
        // Clear existing posts (keep create post card)
        const existingPosts = feedContainer.querySelectorAll('.post-card[data-post-id]');
        existingPosts.forEach(post => post.remove());
        
        // Add new posts
        posts.forEach(post => {
            const postElement = this.createPostElement(post);
            feedContainer.appendChild(postElement);
        });
    }
    
    /**
     * Add new post to feed
     */
    addNewPost(post) {
        const feedContainer = document.getElementById('feedPosts');
        if (!feedContainer) return;
        
        const postElement = this.createPostElement(post);
        feedContainer.insertBefore(postElement, feedContainer.firstChild);
        
        // Animate new post
        postElement.style.animation = 'slideInDown 0.3s ease';
    }
    
    /**
     * Update existing post
     */
    updatePost(post) {
        const postElement = document.querySelector(`[data-post-id="${post.id}"]`);
        if (!postElement) return;
        
        // Update reaction count
        const reactionCount = postElement.querySelector('.post-stats span:first-child');
        if (reactionCount) {
            reactionCount.innerHTML = `<i class="fas fa-fire"></i> ${post.reaction_count} reactions`;
        }
        
        // Update comment count
        const commentCount = postElement.querySelector('.comment-count');
        if (commentCount) {
            commentCount.textContent = post.comment_count;
        }
        
        // Update share count
        const shareCount = postElement.querySelector('.share-count');
        if (shareCount) {
            shareCount.textContent = post.share_count;
        }
    }
    
    /**
     * Create post element
     */
    createPostElement(post) {
        const div = document.createElement('div');
        div.className = 'post-card';
        div.setAttribute('data-post-id', post.id);
        
        const timeAgo = this.formatTimeAgo(post.created_at);
        
        div.innerHTML = `
            <div class="post-header">
                <div class="post-author">
                    <div class="post-avatar">
                        ${post.author.profile_image ? 
                            `<img src="${post.author.profile_image}" alt="${post.author.username}">` :
                            '<i class="fas fa-user-circle"></i>'
                        }
                    </div>
                    <div class="post-author-info">
                        <h4>${post.author.display_name || post.author.username}</h4>
                        <span class="post-time">${timeAgo}</span>
                    </div>
                </div>
                <button class="post-menu-btn">
                    <i class="fas fa-ellipsis-h"></i>
                </button>
            </div>
            <div class="post-content">
                <p>${this.escapeHtml(post.content)}</p>
            </div>
            ${post.media_url ? `
                <div class="post-media">
                    ${post.media_type === 'image' ? 
                        `<img src="${post.media_url}" alt="Post media">` :
                        `<video controls><source src="${post.media_url}" type="video/mp4"></video>`
                    }
                </div>
            ` : ''}
            ${post.achievement_badge ? `
                <div class="post-media">
                    <div class="achievement-badge-large">
                        <i class="fas fa-trophy"></i>
                        <h3>${post.achievement_badge.title || 'Achievement'}</h3>
                        <p>${post.achievement_badge.description || ''}</p>
                    </div>
                </div>
            ` : ''}
            <div class="post-stats">
                <span><i class="fas fa-fire"></i> ${post.reaction_count} reactions</span>
                <span><span class="comment-count">${post.comment_count}</span> comments · <span class="share-count">${post.share_count}</span> shares</span>
            </div>
            <div class="post-actions">
                <button class="post-action-btn" onclick="reactToPost('${post.id}', 'fire')">
                    <i class="fas fa-fire"></i>
                    <span>React</span>
                </button>
                <button class="post-action-btn" onclick="openCommentModal('${post.id}')">
                    <i class="fas fa-comment"></i>
                    <span>Comment</span>
                </button>
                <button class="post-action-btn" onclick="openShareModal('${post.id}')">
                    <i class="fas fa-share"></i>
                    <span>Share</span>
                </button>
            </div>
            <div class="post-comments"></div>
        `;
        
        return div;
    }
    
    /**
     * Update stories
     */
    updateStories(stories) {
        const storiesContainer = document.querySelector('.stories-container');
        if (!storiesContainer) return;
        
        // Keep create story card
        const createStoryCard = storiesContainer.querySelector('.create-story');
        storiesContainer.innerHTML = '';
        
        if (createStoryCard) {
            storiesContainer.appendChild(createStoryCard);
        }
        
        // Add story cards
        stories.forEach(story => {
            const storyElement = this.createStoryElement(story);
            storiesContainer.appendChild(storyElement);
        });
    }
    
    /**
     * Create story element
     */
    createStoryElement(story) {
        const div = document.createElement('div');
        div.className = 'story-card';
        div.setAttribute('data-story-id', story.id);
        
        const gradient = this.getRandomGradient();
        
        div.innerHTML = `
            <div class="story-image" style="background: ${gradient};">
                ${story.profile_image ? 
                    `<img src="${story.profile_image}" alt="${story.username}" style="width: 100%; height: 100%; object-fit: cover;">` :
                    '<i class="fas fa-user"></i>'
                }
            </div>
            <span class="story-name">${story.display_name}</span>
        `;
        
        div.addEventListener('click', () => {
            this.openStory(story);
        });
        
        return div;
    }
    
    /**
     * Update online users list
     */
    updateOnlineUsers(users) {
        const onlineUsersContainer = document.getElementById('onlineUsers');
        if (!onlineUsersContainer) return;
        
        this.onlineUsers.clear();
        users.forEach(user => {
            this.onlineUsers.set(user.id, user);
        });
        
        this.renderOnlineUsers();
    }
    
    /**
     * Render online users
     */
    renderOnlineUsers() {
        const container = document.getElementById('onlineUsers');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.onlineUsers.size === 0) {
            container.innerHTML = '<p class="no-users">No users online</p>';
            return;
        }
        
        this.onlineUsers.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'online-user-item';
            userElement.innerHTML = `
                <div class="online-user-avatar">
                    ${user.profile_image ? 
                        `<img src="${user.profile_image}" alt="${user.username}">` :
                        '<i class="fas fa-user-circle"></i>'
                    }
                    <span class="online-indicator"></span>
                </div>
                <div class="online-user-info">
                    <h4>${user.display_name || user.username}</h4>
                    <p class="online-status">Online now</p>
                </div>
                <button class="btn-follow-small" onclick="followUser('${user.id}')">
                    <i class="fas fa-user-plus"></i>
                </button>
            `;
            container.appendChild(userElement);
        });
    }
    
    /**
     * Handle user followed event
     */
    handleUserFollowed(follower, following) {
        console.log(`${follower.username} followed ${following.username}`);
        // Update UI if needed
    }
    
    /**
     * Handle user online event
     */
    handleUserOnline(user) {
        this.onlineUsers.set(user.id, user);
        this.renderOnlineUsers();
    }
    
    /**
     * Handle user offline event
     */
    handleUserOffline(userId) {
        this.onlineUsers.delete(userId);
        this.renderOnlineUsers();
    }
    
    /**
     * Add new comment
     */
    addNewComment(comment, postId) {
        const postElement = document.querySelector(`[data-post-id="${postId}"]`);
        if (!postElement) return;
        
        const commentsSection = postElement.querySelector('.post-comments');
        if (!commentsSection) return;
        
        const commentElement = document.createElement('div');
        commentElement.className = 'comment-item';
        commentElement.setAttribute('data-comment-id', comment.id);
        
        const timeAgo = this.formatTimeAgo(comment.created_at);
        
        commentElement.innerHTML = `
            <div class="comment-avatar">
                ${comment.author.profile_image ? 
                    `<img src="${comment.author.profile_image}" alt="${comment.author.username}">` :
                    '<i class="fas fa-user-circle"></i>'
                }
            </div>
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${comment.author.display_name || comment.author.username}</strong>
                    <span class="comment-time">${timeAgo}</span>
                </div>
                <p class="comment-text">${this.escapeHtml(comment.content)}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn" onclick="reactToComment('${comment.id}', 'fire')">
                        <i class="fas fa-fire"></i> React
                    </button>
                    <button class="comment-action-btn" onclick="replyToComment('${comment.id}')">
                        <i class="fas fa-reply"></i> Reply
                    </button>
                </div>
            </div>
        `;
        
        commentsSection.insertBefore(commentElement, commentsSection.firstChild);
    }
    
    /**
     * Show notification
     */
    showNotification(title, message, icon = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${icon}`;
        notification.innerHTML = `
            <i class="fas fa-${icon === 'success' ? 'check-circle' : icon === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <div class="notification-content">
                <h4>${title}</h4>
                <p>${message}</p>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
    
    /**
     * Show follow notification
     */
    showFollowNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'notification notification-follow';
        notification.innerHTML = `
            <div class="notification-avatar">
                ${data.follower_image ? 
                    `<img src="${data.follower_image}" alt="${data.follower_name}">` :
                    '<i class="fas fa-user-circle"></i>'
                }
            </div>
            <div class="notification-content">
                <p><strong>${data.follower_name}</strong> started following you</p>
            </div>
            <button class="btn-follow-small" onclick="followUser('${data.follower_id}')">
                <i class="fas fa-user-plus"></i>
            </button>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
    
    /**
     * Show comment notification
     */
    showCommentNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'notification notification-comment';
        notification.innerHTML = `
            <div class="notification-content">
                <p><strong>${data.commenter_name}</strong> commented: "${data.comment_preview}"</p>
            </div>
            <button class="btn-small" onclick="scrollToPost('${data.post_id}')">
                <i class="fas fa-arrow-right"></i>
            </button>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
    
    /**
     * Request feed update via HTTP polling
     */
    async requestFeedUpdate() {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;
            
            const response = await fetch(`${API_BASE_URL}/social/posts/`, {
                method: 'GET',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                const posts = data.results || data;
                this.handleFeedMessage({
                    type: 'feed_update',
                    posts: Array.isArray(posts) ? posts : []
                });
            }
        } catch (error) {
            console.warn('Feed update failed:', error.message);
        }
    }
    
    /**
     * Request notification update via HTTP polling
     */
    async requestNotificationUpdate() {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;
            
            const response = await fetch(`${API_BASE_URL}/notifications/`, {
                method: 'GET',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                const notifications = data.results || data;
                
                if (Array.isArray(notifications)) {
                    notifications.forEach(notif => {
                        this.handleNotificationMessage({
                            type: 'notification',
                            title: notif.title || 'Notification',
                            message: notif.message || notif.description || '',
                            icon: 'info'
                        });
                    });
                }
            }
        } catch (error) {
            console.warn('Notification update failed:', error.message);
        }
    }
    
    /**
     * Request stories update via HTTP polling
     */
    async requestStoriesUpdate() {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;
            
            const response = await fetch(`${API_BASE_URL}/social/stories/feed/`, {
                method: 'GET',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                const stories = data.results || data;
                this.handleFeedMessage({
                    type: 'stories_update',
                    stories: Array.isArray(stories) ? stories : []
                });
            }
        } catch (error) {
            console.warn('Stories update failed:', error.message);
        }
    }
    
    /**
     * Request online users update via HTTP polling
     */
    async requestOnlineUsersUpdate() {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;
            
            // This would require an endpoint to track online users
            // For now, just log that it's not available
            console.log('💡 Online users tracking requires WebSocket or additional backend support');
        } catch (error) {
            console.warn('Online users update failed:', error.message);
        }
    }
    
    /**
     * Attempt to reconnect (polling-based)
     */
    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            setTimeout(() => {
                this.startPolling();
            }, this.reconnectDelay);
        }
    }
    
    /**
     * Reconnect all connections (polling-based)
     */
    reconnect() {
        if (!this.isConnected) {
            this.startPolling();
        }
    }
    
    /**
     * Disconnect all connections
     */
    disconnect() {
        this.stopPolling();
    }
    
    /**
     * Utility: Format time ago
     */
    formatTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;
        
        return date.toLocaleDateString();
    }
    
    /**
     * Utility: Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Utility: Get random gradient
     */
    getRandomGradient() {
        const gradients = [
            'linear-gradient(135deg, #667eea, #764ba2)',
            'linear-gradient(135deg, #f093fb, #f5576c)',
            'linear-gradient(135deg, #4facfe, #00f2fe)',
            'linear-gradient(135deg, #43e97b, #38f9d7)',
            'linear-gradient(135deg, #fa709a, #fee140)',
            'linear-gradient(135deg, #30cfd0, #330867)',
        ];
        return gradients[Math.floor(Math.random() * gradients.length)];
    }
    
    /**
     * Open story
     */
    openStory(story) {
        console.log('Opening story:', story);
        // Implement story viewer modal
    }
}

// Initialize on page load
let realtimeUpdates;

document.addEventListener('DOMContentLoaded', function() {
    realtimeUpdates = new RealtimeUpdates();
    realtimeUpdates.init();
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (realtimeUpdates) {
        realtimeUpdates.disconnect();
    }
});
