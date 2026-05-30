/**
 * Real-time Social Features
 * - Comments with modal
 * - Social media sharing
 * - Real-time updates
 */

const API_BASE = '/api/social';

// ============================================
// COMMENT MODAL & FUNCTIONALITY
// ============================================

function openCommentModal(postId) {
    const modal = document.getElementById('commentModal');
    if (!modal) {
        createCommentModal();
    }
    
    document.getElementById('commentModal').style.display = 'flex';
    document.getElementById('commentPostId').value = postId;
    document.getElementById('commentInput').focus();
}

function closeCommentModal() {
    const modal = document.getElementById('commentModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('commentInput').value = '';
    }
}

function createCommentModal() {
    const modalHTML = `
        <div id="commentModal" class="modal-overlay" style="display: none;">
            <div class="modal-content comment-modal">
                <div class="modal-header">
                    <h2>Add Comment</h2>
                    <button class="modal-close-btn" onclick="closeCommentModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="modal-body">
                    <input type="hidden" id="commentPostId" value="">
                    
                    <div class="comment-input-section">
                        <div class="comment-avatar">
                            <i class="fas fa-user-circle"></i>
                        </div>
                        <textarea 
                            id="commentInput" 
                            class="comment-textarea" 
                            placeholder="Share your thoughts..."
                            maxlength="1000"
                        ></textarea>
                    </div>
                    
                    <div class="comment-char-count">
                        <span id="charCount">0</span>/1000
                    </div>
                    
                    <div class="comment-actions">
                        <button class="btn-secondary" onclick="closeCommentModal()">Cancel</button>
                        <button class="btn-primary" onclick="submitComment()">Post Comment</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Character counter
    document.getElementById('commentInput').addEventListener('input', function() {
        document.getElementById('charCount').textContent = this.value.length;
    });
}

async function submitComment() {
    const postId = document.getElementById('commentPostId').value;
    const content = document.getElementById('commentInput').value.trim();
    
    if (!content) {
        alert('Please enter a comment');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/comments/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                post_id: postId,
                content: content
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to post comment');
        }
        
        const comment = await response.json();
        
        // Add comment to UI
        addCommentToUI(comment);
        
        // Close modal and reset
        closeCommentModal();
        
        // Show success message
        showNotification('Comment posted successfully!', 'success');
        
        // Update comment count
        updateCommentCount(postId);
        
    } catch (error) {
        console.error('Error posting comment:', error);
        showNotification('Failed to post comment', 'error');
    }
}

function addCommentToUI(comment) {
    const postId = document.getElementById('commentPostId').value;
    const commentsSection = document.querySelector(`[data-post-id="${postId}"] .post-comments`);
    
    if (!commentsSection) return;
    
    const commentHTML = `
        <div class="comment-item" data-comment-id="${comment.id}">
            <div class="comment-avatar">
                <i class="fas fa-user-circle"></i>
            </div>
            <div class="comment-content">
                <div class="comment-header">
                    <strong>${comment.author.display_name || comment.author.username}</strong>
                    <span class="comment-time">${formatTime(comment.created_at)}</span>
                </div>
                <p class="comment-text">${escapeHtml(comment.content)}</p>
                <div class="comment-actions">
                    <button class="comment-action-btn" onclick="reactToComment('${comment.id}', 'fire')">
                        <i class="fas fa-fire"></i> React
                    </button>
                    <button class="comment-action-btn" onclick="replyToComment('${comment.id}')">
                        <i class="fas fa-reply"></i> Reply
                    </button>
                </div>
            </div>
        </div>
    `;
    
    commentsSection.insertAdjacentHTML('beforeend', commentHTML);
}

function updateCommentCount(postId) {
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (postCard) {
        const countElement = postCard.querySelector('.comment-count');
        if (countElement) {
            const currentCount = parseInt(countElement.textContent) || 0;
            countElement.textContent = currentCount + 1;
        }
    }
}

async function reactToComment(commentId, reactionType) {
    try {
        const response = await fetch(`${API_BASE}/comments/${commentId}/react/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                reaction_type: reactionType
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to react to comment');
        }
        
        showNotification('Reaction added!', 'success');
        
    } catch (error) {
        console.error('Error reacting to comment:', error);
    }
}

function replyToComment(commentId) {
    // Open comment modal with parent comment ID
    openCommentModal(document.getElementById('commentPostId').value);
    // Store parent comment ID for reply
    document.getElementById('commentParentId').value = commentId;
}

// ============================================
// SOCIAL MEDIA SHARING
// ============================================

function openShareModal(postId) {
    const modal = document.getElementById('shareModal');
    if (!modal) {
        createShareModal();
    }
    
    document.getElementById('shareModal').style.display = 'flex';
    document.getElementById('sharePostId').value = postId;
    
    // Load share URLs
    loadShareUrls(postId);
}

function closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function createShareModal() {
    const modalHTML = `
        <div id="shareModal" class="modal-overlay" style="display: none;">
            <div class="modal-content share-modal">
                <div class="modal-header">
                    <h2>Share Post</h2>
                    <button class="modal-close-btn" onclick="closeShareModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="modal-body">
                    <input type="hidden" id="sharePostId" value="">
                    
                    <div class="share-options">
                        <button class="share-btn facebook-btn" onclick="shareToFacebook()">
                            <i class="fab fa-facebook-f"></i>
                            <span>Facebook</span>
                        </button>
                        
                        <button class="share-btn whatsapp-btn" onclick="shareToWhatsApp()">
                            <i class="fab fa-whatsapp"></i>
                            <span>WhatsApp</span>
                        </button>
                        
                        <button class="share-btn x-btn" onclick="shareToX()">
                            <i class="fab fa-x-twitter"></i>
                            <span>X (Twitter)</span>
                        </button>
                        
                        <button class="share-btn copy-btn" onclick="copyShareLink()">
                            <i class="fas fa-link"></i>
                            <span>Copy Link</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

async function loadShareUrls(postId) {
    try {
        const response = await fetch(`${API_BASE}/posts/${postId}/share_urls/`, {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to load share URLs');
        }
        
        const urls = await response.json();
        
        // Store URLs for later use
        window.shareUrls = urls;
        
    } catch (error) {
        console.error('Error loading share URLs:', error);
    }
}

async function shareToFacebook() {
    const postId = document.getElementById('sharePostId').value;
    
    try {
        // Record share
        await recordShare(postId, 'facebook');
        
        // Open Facebook share dialog
        if (window.shareUrls && window.shareUrls.facebook) {
            window.open(window.shareUrls.facebook, 'facebook-share', 'width=600,height=400');
        }
        
        closeShareModal();
        showNotification('Shared to Facebook!', 'success');
        
    } catch (error) {
        console.error('Error sharing to Facebook:', error);
    }
}

async function shareToWhatsApp() {
    const postId = document.getElementById('sharePostId').value;
    
    try {
        // Record share
        await recordShare(postId, 'whatsapp');
        
        // Open WhatsApp share
        if (window.shareUrls && window.shareUrls.whatsapp) {
            window.open(window.shareUrls.whatsapp, 'whatsapp-share');
        }
        
        closeShareModal();
        showNotification('Shared to WhatsApp!', 'success');
        
    } catch (error) {
        console.error('Error sharing to WhatsApp:', error);
    }
}

async function shareToX() {
    const postId = document.getElementById('sharePostId').value;
    
    try {
        // Record share
        await recordShare(postId, 'x');
        
        // Open X share
        if (window.shareUrls && window.shareUrls.x) {
            window.open(window.shareUrls.x, 'x-share', 'width=600,height=400');
        }
        
        closeShareModal();
        showNotification('Shared to X!', 'success');
        
    } catch (error) {
        console.error('Error sharing to X:', error);
    }
}

async function copyShareLink() {
    const postId = document.getElementById('sharePostId').value;
    
    try {
        // Record share
        await recordShare(postId, 'copy_link');
        
        // Copy link to clipboard
        if (window.shareUrls && window.shareUrls.copy_link) {
            await navigator.clipboard.writeText(window.shareUrls.copy_link);
            showNotification('Link copied to clipboard!', 'success');
        }
        
        closeShareModal();
        
    } catch (error) {
        console.error('Error copying link:', error);
        showNotification('Failed to copy link', 'error');
    }
}

async function recordShare(postId, platform) {
    try {
        const response = await fetch(`${API_BASE}/posts/${postId}/share/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify({
                platform: platform
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to record share');
        }
        
        // Update share count
        updateShareCount(postId);
        
    } catch (error) {
        console.error('Error recording share:', error);
    }
}

function updateShareCount(postId) {
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (postCard) {
        const countElement = postCard.querySelector('.share-count');
        if (countElement) {
            const currentCount = parseInt(countElement.textContent) || 0;
            countElement.textContent = currentCount + 1;
        }
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getAuthToken() {
    // Get token from localStorage or sessionStorage
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
}

function formatTime(dateString) {
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// ============================================
// EVENT LISTENERS
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    // Create modals on page load
    createCommentModal();
    createShareModal();
    
    // Close modals on outside click
    document.addEventListener('click', function(event) {
        const commentModal = document.getElementById('commentModal');
        const shareModal = document.getElementById('shareModal');
        
        if (event.target === commentModal) {
            closeCommentModal();
        }
        if (event.target === shareModal) {
            closeShareModal();
        }
    });
    
    // Close modals on Escape key
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            closeCommentModal();
            closeShareModal();
        }
    });
});
