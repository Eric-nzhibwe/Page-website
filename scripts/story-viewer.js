/**
 * Story Viewer System
 * - View stories in modal
 * - Real-time viewer tracking
 * - Story expiry countdown
 * - Viewer list with real-time updates
 */

class StoryViewer {
    constructor() {
        this.currentStory = null;
        this.currentStoryIndex = 0;
        this.stories = [];
        this.viewers = new Map();
        this.storySocket = null;
        this.storyPollInterval = null;
        this.autoPlayTimer = null;
        this.expiryTimer = null;
        this.storyWs = null;
    }
    
    /**
     * Open story viewer modal
     */
    openStory(storyId, stories = []) {
        this.stories = stories;
        this.currentStoryIndex = stories.findIndex(s => s.id === storyId);
        
        if (this.currentStoryIndex === -1) {
            this.currentStoryIndex = 0;
        }
        
        this.displayStory();
        this.markStoryAsViewed(storyId);
        this.loadViewers(storyId);
        this.connectStorySocket(storyId);
    }
    
    /**
     * Display current story
     */
    displayStory() {
        if (this.stories.length === 0) return;
        
        this.currentStory = this.stories[this.currentStoryIndex];
        const modal = this.getOrCreateStoryModal();
        
        // Update story content
        const storyContent = modal.querySelector('.story-viewer-content');
        storyContent.innerHTML = this.renderStoryContent(this.currentStory);
        
        // Update viewer list
        this.updateViewersList();
        
        // Update progress bar
        this.updateProgressBar();
        
        // Show modal
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('story-modal--visible'));
        
        // Start auto-play
        this.startAutoPlay();
        
        // Start expiry countdown
        this.startExpiryCountdown();
    }
    
    /**
     * Render story content
     */
    renderStoryContent(story) {
        const timeAgo = this.formatTimeAgo(story.created_at);
        const expiryTime = this.formatTimeRemaining(story.time_until_expiry);
        
        let mediaHTML = '';
        if (story.media_type === 'image') {
            mediaHTML = `<img src="${story.media_url}" alt="Story" class="story-media">`;
        } else if (story.media_type === 'video') {
            mediaHTML = `<video controls class="story-media"><source src="${story.media_url}" type="video/mp4"></video>`;
        }
        
        return `
            <div class="story-viewer-header">
                <div class="story-author-info">
                    <div class="story-author-avatar">
                        ${story.author.profile_image ? 
                            `<img src="${story.author.profile_image}" alt="${story.author.username}">` :
                            '<i class="fas fa-user-circle"></i>'
                        }
                    </div>
                    <div class="story-author-details">
                        <h3>${story.author.display_name || story.author.username}</h3>
                        <p class="story-time">${timeAgo}</p>
                    </div>
                </div>
                <div class="story-expiry">
                    <i class="fas fa-clock"></i>
                    <span id="expiryCountdown">${expiryTime}</span>
                </div>
            </div>
            
            <div class="story-media-container">
                ${mediaHTML}
                ${story.content ? `<div class="story-text-overlay">${this.escapeHtml(story.content)}</div>` : ''}
            </div>
            
            <div class="story-footer">
                <div class="story-stats">
                    <span class="view-count">
                        <i class="fas fa-eye"></i>
                        ${story.view_count} views
                    </span>
                </div>
            </div>
        `;
    }
    
    /**
     * Get or create story modal
     */
    getOrCreateStoryModal() {
        let modal = document.getElementById('storyViewerModal');
        
        if (!modal) {
            const modalHTML = `
                <div id="storyViewerModal" class="modal-overlay story-modal-overlay" style="display: none;">
                    <div class="story-viewer-container">
                        <!-- Story Content -->
                        <div class="story-viewer-main">
                            <div class="story-viewer-content"></div>
                            
                            <!-- Navigation -->
                            <button class="story-nav-btn story-prev-btn" onclick="storyViewer.previousStory()">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <button class="story-nav-btn story-next-btn" onclick="storyViewer.nextStory()">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                            
                            <!-- Close Button -->
                            <button class="story-close-btn" onclick="storyViewer.closeStory()">
                                <i class="fas fa-times"></i>
                            </button>
                            
                            <!-- Progress Bar -->
                            <div class="story-progress-container">
                                <div id="storyProgressBar" class="story-progress-bar"></div>
                            </div>
                        </div>
                        
                        <!-- Viewers Sidebar -->
                        <div class="story-viewers-sidebar">
                            <div class="viewers-header">
                                <h3>Viewers</h3>
                                <span class="viewer-count" id="viewerCount">0</span>
                            </div>
                            <div class="viewers-list" id="viewersList">
                                <p class="loading">Loading viewers...</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            modal = document.getElementById('storyViewerModal');
            
            // Close on outside click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeStory();
                }
            });
            
            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (modal.style.display === 'flex') {
                    if (e.key === 'ArrowLeft') this.previousStory();
                    if (e.key === 'ArrowRight') this.nextStory();
                    if (e.key === 'Escape') this.closeStory();
                }
            });
        }
        
        return modal;
    }
    
    /**
     * Update progress bar
     */
    updateProgressBar() {
        const progressBar = document.getElementById('storyProgressBar');
        if (progressBar) {
            const progress = ((this.currentStoryIndex + 1) / this.stories.length) * 100;
            progressBar.style.width = progress + '%';
        }
    }
    
    /**
     * Update viewers list
     */
    updateViewersList() {
        const viewersList = document.getElementById('viewersList');
        const viewerCount = document.getElementById('viewerCount');
        
        if (!viewersList || !this.currentStory) return;
        
        const viewers = this.viewers.get(this.currentStory.id) || [];
        
        viewerCount.textContent = viewers.length;
        
        if (viewers.length === 0) {
            viewersList.innerHTML = '<p class="no-viewers">No viewers yet</p>';
            return;
        }
        
        viewersList.innerHTML = viewers.map(viewer => `
            <div class="viewer-item">
                <div class="viewer-avatar">
                    ${viewer.profile_image ? 
                        `<img src="${viewer.profile_image}" alt="${viewer.username}">` :
                        '<i class="fas fa-user-circle"></i>'
                    }
                </div>
                <div class="viewer-info">
                    <h4>${viewer.display_name || viewer.username}</h4>
                    <p class="viewer-time">${this.formatTimeAgo(viewer.viewed_at)}</p>
                </div>
            </div>
        `).join('');
    }
    
    /**
     * Next story
     */
    nextStory() {
        if (this.currentStoryIndex < this.stories.length - 1) {
            this.currentStoryIndex++;
            this.displayStory();
        } else {
            this.closeStory();
        }
    }
    
    /**
     * Previous story
     */
    previousStory() {
        if (this.currentStoryIndex > 0) {
            this.currentStoryIndex--;
            this.displayStory();
        }
    }
    
    /**
     * Close story viewer
     */
    closeStory() {
        const modal = document.getElementById('storyViewerModal');
        if (modal) {
            modal.classList.remove('story-modal--visible');
            setTimeout(() => { modal.style.display = 'none'; }, 250);
        }
        this.clearTimers();
        this.disconnectStorySocket();
        this.currentStory = null;
        this.stories      = [];
    }
    
    /**
     * Mark story as viewed
     */
    async markStoryAsViewed(storyId) {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;
            await fetch(`/api/social/stories/${storyId}/view/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${token}`,
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.warn('Could not mark story as viewed:', error.message);
        }
    }

    /**
     * Load viewers for story
     */
    async loadViewers(storyId) {
        try {
            const token = localStorage.getItem('djangoAuthToken');
            if (!token) return;

            const response = await fetch(`/api/social/stories/${storyId}/viewers/`, {
                headers: { 'Authorization': `Token ${token}` }
            });

            if (response.ok) {
                const viewers = await response.json();
                const list = Array.isArray(viewers) ? viewers : (viewers.results || []);
                this.viewers.set(storyId, list);
                this.updateViewersList();
            }
        } catch (error) {
            console.warn('Could not load viewers:', error.message);
        }
    }

    /**
     * Connect to story updates — WebSocket with polling fallback
     */
    connectStorySocket(storyId) {
        // Connect to the stories WS room if not already connected
        wsClient.connectToStories({
            onView: (view, viewedStoryId) => {
                if (viewedStoryId === this.currentStory?.id) {
                    this.addViewer(view.viewer || view);
                }
            }
        });
        // Send our view via WS
        wsClient.sendStoryView(storyId);

        // Also poll every 15 s as safety net
        this.startPolling(storyId);
    }
    
    /**
     * Start polling as fallback
     */
    startPolling(storyId) {
        // Poll for viewer updates every 5 seconds
        this.storyPollInterval = setInterval(() => {
            this.loadViewers(storyId);
        }, 5000);
    }
    
    /**
     * Disconnect story polling
     */
    disconnectStorySocket() {
        if (this.storyPollInterval) {
            clearInterval(this.storyPollInterval);
            this.storyPollInterval = null;
        }
    }
    addViewer(viewer) {
        if (!this.currentStory) return;
        
        const viewers = this.viewers.get(this.currentStory.id) || [];
        
        // Check if viewer already exists
        if (!viewers.find(v => v.id === viewer.id)) {
            viewers.unshift(viewer);
            this.viewers.set(this.currentStory.id, viewers);
            this.updateViewersList();
            
            // Show notification
            this.showViewerNotification(viewer);
        }
    }
    
    /**
     * Show viewer notification — use toast instead of DOM injection
     */
    showViewerNotification(viewer) {
        const name = viewer.display_name || viewer.username || 'Someone';
        if (typeof socialToast === 'function') {
            socialToast(`${name} viewed your story 👁️`, 'info');
        }
    }
    
    /**
     * Start auto-play timer
     */
    startAutoPlay() {
        this.clearAutoPlayTimer();
        
        this.autoPlayTimer = setTimeout(() => {
            this.nextStory();
        }, 5000); // 5 seconds per story
    }
    
    /**
     * Start expiry countdown
     */
    startExpiryCountdown() {
        this.clearExpiryTimer();
        
        if (!this.currentStory) return;
        
        const updateCountdown = () => {
            const countdownElement = document.getElementById('expiryCountdown');
            if (!countdownElement) return;
            
            const remaining = this.currentStory.time_until_expiry - 1;
            this.currentStory.time_until_expiry = remaining;
            
            countdownElement.textContent = this.formatTimeRemaining(remaining);
            
            if (remaining > 0) {
                this.expiryTimer = setTimeout(updateCountdown, 1000);
            }
        };
        
        this.expiryTimer = setTimeout(updateCountdown, 1000);
    }
    
    /**
     * Add viewer to list
     */
    clearTimers() {
        this.clearAutoPlayTimer();
        this.clearExpiryTimer();
    }
    
    /**
     * Clear auto-play timer
     */
    clearAutoPlayTimer() {
        if (this.autoPlayTimer) {
            clearTimeout(this.autoPlayTimer);
            this.autoPlayTimer = null;
        }
    }
    
    /**
     * Clear expiry timer
     */
    clearExpiryTimer() {
        if (this.expiryTimer) {
            clearTimeout(this.expiryTimer);
            this.expiryTimer = null;
        }
    }
    
    /**
     * Utility: Get auth token
     */
    getAuthToken() {
        return localStorage.getItem('djangoAuthToken') || '';
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
     * Utility: Format time remaining
     */
    formatTimeRemaining(seconds) {
        if (seconds <= 0) return 'Expired';
        
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }
    
    /**
     * Utility: Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize story viewer
let storyViewer;

document.addEventListener('DOMContentLoaded', function() {
    storyViewer = new StoryViewer();
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (storyViewer) {
        storyViewer.closeStory();
    }
});
