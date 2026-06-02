// Social Feed JavaScript

// Toggle Dashboard Menu
function toggleDashboardMenu() {
    const dropdown = document.getElementById('dashboardDropdown');
    dropdown.classList.toggle('show');
}

// Close dropdown when clicking outside
window.addEventListener('click', function(event) {
    if (!event.target.matches('.btn-dashboard-toggle') && !event.target.matches('.btn-dashboard-toggle *')) {
        const dropdowns = document.getElementsByClassName('dashboard-dropdown-content');
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
});

// Show Dashboard View
function showDashboardView() {
    // Hide social feed
    document.getElementById('social-feed').classList.remove('active');
    // Show dashboard
    document.getElementById('dashboard').classList.add('active');
    
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === 'dashboard') {
            btn.classList.add('active');
        }
    });
}

// Scroll to section
function scrollToSection(sectionId) {
    // First show dashboard if not visible
    showDashboardView();
    
    // Then scroll to section
    setTimeout(() => {
        const element = document.getElementById(sectionId);
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 300);
}

// Create Post Modal Functions
let selectedMedia = null;
let selectedMediaType = null;

function openCreatePostModal(type = null) {
    const modal = document.getElementById('createPostModal');
    modal.style.display = 'block';
    
    // Set creator name - try multiple possible username elements
    const usernameEl = document.getElementById('username') || 
                       document.getElementById('userMenuName') || 
                       document.getElementById('sidebarUsername');
    
    const username = usernameEl ? usernameEl.textContent : 'Player';
    const postCreatorName = document.getElementById('postCreatorName');
    if (postCreatorName) {
        postCreatorName.textContent = username;
    }
    
    // If type is specified, trigger that action
    if (type === 'photo') {
        triggerMediaUpload('image');
    } else if (type === 'video') {
        triggerMediaUpload('video');
    } else if (type === 'achievement') {
        addAchievement();
    }
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    modal.style.display = 'none';
    
    // Clear form
    document.getElementById('postContent').value = '';
    removePostMedia();
}

function triggerMediaUpload(type) {
    const input = document.getElementById('mediaUploadInput');
    
    if (type === 'image') {
        input.accept = 'image/*';
        input.multiple = true; // Allow multiple images
    } else if (type === 'video') {
        input.accept = 'video/*';
        input.multiple = false;
    }
    
    input.click();
}

function handleMediaUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const preview = document.getElementById('postMediaPreview');
    const previewContent = document.getElementById('mediaPreviewContent');
    previewContent.innerHTML = ''; // Clear previous
    
    // Handle multiple files
    Array.from(files).forEach((file, index) => {
        if (file.type.startsWith('image/')) {
            selectedMedia = file;
            selectedMediaType = 'image';
            
            const reader = new FileReader();
            reader.onload = function(e) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'media-preview-item';
                imgContainer.innerHTML = `
                    <img src="${e.target.result}" alt="Preview ${index + 1}">
                    <button class="remove-media-btn" onclick="removeMediaItem(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                `;
                previewContent.appendChild(imgContainer);
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            selectedMedia = file;
            selectedMediaType = 'video';
            
            const reader = new FileReader();
            reader.onload = function(e) {
                previewContent.innerHTML = `
                    <div class="media-preview-item video-preview">
                        <video src="${e.target.result}" controls></video>
                        <button class="remove-media-btn" onclick="removePostMedia()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
            };
            reader.readAsDataURL(file);
        }
    });
    
    preview.style.display = 'block';
}

function removeMediaItem(index) {
    // In a real app, would remove from array
    const preview = document.getElementById('postMediaPreview');
    const items = preview.querySelectorAll('.media-preview-item');
    if (items[index]) {
        items[index].remove();
    }
    
    // Hide preview if no items left
    if (preview.querySelectorAll('.media-preview-item').length === 0) {
        preview.style.display = 'none';
        selectedMedia = null;
        selectedMediaType = null;
    }
}

function removePostMedia() {
    selectedMedia = null;
    selectedMediaType = null;
    document.getElementById('postMediaPreview').style.display = 'none';
    document.getElementById('mediaPreviewContent').innerHTML = '';
    document.getElementById('mediaUploadInput').value = '';
}

function addAchievement() {
    const preview = document.getElementById('postMediaPreview');
    const previewContent = document.getElementById('mediaPreviewContent');
    
    selectedMediaType = 'achievement';
    
    previewContent.innerHTML = `
        <div class="achievement-badge-large">
            <i class="fas fa-trophy"></i>
            <h3>Achievement Unlocked!</h3>
            <p>Share your success</p>
        </div>
    `;
    preview.style.display = 'block';
}

function addLocation() {
    const content = document.getElementById('postContent');
    const currentText = content.value;
    
    // Simple location addition - in real app, would use geolocation API
    const location = '📍 Current Location';
    
    if (currentText) {
        content.value = currentText + '\n' + location;
    } else {
        content.value = location;
    }
}

function publishPost() {
    const content = document.getElementById('postContent').value.trim();
    
    if (!content && !selectedMedia) {
        alert('Please add some content or media to your post!');
        return;
    }
    
    // Get user info - try multiple possible username elements
    const usernameEl = document.getElementById('username') || 
                       document.getElementById('userMenuName') || 
                       document.getElementById('sidebarUsername');
    
    const username = usernameEl ? usernameEl.textContent : 'Player';
    
    // Collect media data
    let mediaData = [];
    const mediaItems = document.querySelectorAll('#mediaPreviewContent .media-preview-item');
    
    if (mediaItems.length > 0) {
        mediaItems.forEach((item) => {
            const img = item.querySelector('img');
            const video = item.querySelector('video');
            
            if (img) {
                mediaData.push({ type: 'image', src: img.src });
            } else if (video) {
                mediaData.push({ type: 'video', src: video.src });
            }
        });
    } else if (selectedMediaType === 'achievement') {
        mediaData.push({ type: 'achievement', html: document.getElementById('mediaPreviewContent').innerHTML });
    }
    
    // Create post object
    const post = {
        id: Date.now(),
        username: username,
        content: content,
        media: mediaData,
        timestamp: new Date().toISOString(),
        reactions: 0,
        comments: 0,
        shares: 0
    };
    
    // Save to localStorage
    savePostToStorage(post);
    
    // Display the post
    displayPost(post, true);
    
    // Close modal
    closeCreatePostModal();
    
    // Show success message
    showNotification('Post published successfully! 🎉');
}

// Save post to localStorage
function savePostToStorage(post) {
    let posts = JSON.parse(localStorage.getItem('userPosts') || '[]');
    posts.unshift(post); // Add to beginning
    
    // Keep only last 50 posts to avoid storage issues
    if (posts.length > 50) {
        posts = posts.slice(0, 50);
    }
    
    localStorage.setItem('userPosts', JSON.stringify(posts));
}

// Display a single post
function displayPost(post, animate = false) {
    const userAvatar = '<i class="fas fa-user-circle"></i>';
    
    // Create post element
    const postCard = document.createElement('div');
    postCard.className = 'post-card';
    postCard.setAttribute('data-post-id', post.id);
    
    if (animate) {
        postCard.style.animation = 'fadeIn 0.5s';
    }
    
    let mediaHTML = '';
    
    // Handle media
    if (post.media && post.media.length > 0) {
        if (post.media[0].type === 'achievement') {
            mediaHTML = '<div class="post-media">' + post.media[0].html + '</div>';
        } else {
            mediaHTML = '<div class="post-media"><div class="post-media-grid">';
            
            post.media.forEach((media, index) => {
                if (media.type === 'image') {
                    mediaHTML += `<div class="post-media-item"><img src="${media.src}" alt="Post image ${index + 1}"></div>`;
                } else if (media.type === 'video') {
                    mediaHTML += `<div class="post-media-item video-item"><video src="${media.src}" controls></video></div>`;
                }
            });
            
            mediaHTML += '</div></div>';
        }
    }
    
    // Calculate time ago
    const timeAgo = getTimeAgo(post.timestamp);
    
    postCard.innerHTML = `
        <div class="post-header">
            <div class="post-author">
                <div class="post-avatar">
                    ${userAvatar}
                </div>
                <div class="post-author-info">
                    <h4>${post.username}</h4>
                    <span class="post-time">${timeAgo}</span>
                </div>
            </div>
            <button class="post-menu-btn" onclick="showPostMenu(${post.id})">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
        <div class="post-content">
            <p>${post.content.replace(/\n/g, '<br>')}</p>
        </div>
        ${mediaHTML}
        <div class="post-stats">
            <span><i class="fas fa-fire"></i> ${post.reactions} reactions</span>
            <span>${post.comments} comments · ${post.shares} shares</span>
        </div>
        <div class="post-actions">
            <button class="post-action-btn" onclick="reactToPost(${post.id})">
                <i class="fas fa-fire"></i>
                <span>React</span>
            </button>
            <button class="post-action-btn" onclick="openCommentModal(${post.id})">
                <i class="fas fa-comment"></i>
                <span>Comment</span>
            </button>
            <button class="post-action-btn" onclick="openShareModal(${post.id})">
                <i class="fas fa-share"></i>
                <span>Share</span>
            </button>
        </div>
    `;
    
    // Insert at the beginning of feed
    const feedPosts = document.getElementById('feedPosts');
    feedPosts.insertBefore(postCard, feedPosts.firstChild);
}

// Load all posts from localStorage
function loadPostsFromStorage() {
    const posts = JSON.parse(localStorage.getItem('userPosts') || '[]');
    
    // Clear existing user posts (keep sample posts)
    const feedPosts = document.getElementById('feedPosts');
    const userPosts = feedPosts.querySelectorAll('[data-post-id]');
    userPosts.forEach(post => post.remove());
    
    // Display posts in reverse order (newest first)
    posts.forEach(post => {
        displayPost(post, false);
    });
}

// Calculate time ago
function getTimeAgo(timestamp) {
    const now = new Date();
    const postTime = new Date(timestamp);
    const diffMs = now - postTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return postTime.toLocaleDateString();
}

// Show post menu (edit/delete)
function showPostMenu(postId) {
    const menu = document.createElement('div');
    menu.className = 'post-menu-dropdown';
    menu.innerHTML = `
        <button onclick="deletePost(${postId})">
            <i class="fas fa-trash"></i> Delete Post
        </button>
    `;
    
    // Position menu
    const btn = event.target.closest('.post-menu-btn');
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 5 + 'px';
    menu.style.right = window.innerWidth - rect.right + 'px';
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    // Close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

// Delete post
function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post?')) {
        return;
    }
    
    // Remove from localStorage
    let posts = JSON.parse(localStorage.getItem('userPosts') || '[]');
    posts = posts.filter(post => post.id !== postId);
    localStorage.setItem('userPosts', JSON.stringify(posts));
    
    // Remove from DOM
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (postCard) {
        postCard.style.animation = 'fadeOut 0.3s';
        setTimeout(() => {
            postCard.remove();
        }, 300);
    }
    
    showNotification('Post deleted successfully');
}

// React to post
function reactToPost(postId) {
    // Update in localStorage
    let posts = JSON.parse(localStorage.getItem('userPosts') || '[]');
    const post = posts.find(p => p.id === postId);
    
    if (post) {
        post.reactions = (post.reactions || 0) + 1;
        localStorage.setItem('userPosts', JSON.stringify(posts));
        
        // Update in DOM
        const postCard = document.querySelector(`[data-post-id="${postId}"]`);
        if (postCard) {
            const statsEl = postCard.querySelector('.post-stats span:first-child');
            if (statsEl) {
                statsEl.innerHTML = `<i class="fas fa-fire"></i> ${post.reactions} reactions`;
            }
        }
        
        // Visual feedback
        const btn = event.target.closest('.post-action-btn');
        btn.style.color = '#90ee90';
        setTimeout(() => {
            btn.style.color = '';
        }, 1000);
    }
}

function showNotification(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: linear-gradient(135deg, darkolivegreen, lightgreen);
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Update sidebar with user data
function updateSocialSidebar() {
    // Get username from multiple possible sources
    const usernameEl = document.getElementById('username') || 
                       document.getElementById('userMenuName') || 
                       document.getElementById('sidebarUsername');
    
    const username = usernameEl ? usernameEl.textContent : 'Player';
    
    const prestigeEl = document.getElementById('userPrestige') || 
                       document.getElementById('sidebarPrestige');
    const prestige = prestigeEl ? prestigeEl.textContent : '0';
    
    const tierEl = document.getElementById('tierBadge') || 
                   document.getElementById('sidebarTier');
    const tier = tierEl ? tierEl.textContent : 'Bronze Tier';
    const rank = document.getElementById('yourRank').textContent;
    
    // Update left sidebar
    document.getElementById('sidebarUsername').textContent = username;
    document.getElementById('sidebarTier').textContent = tier + ' Tier';
    document.getElementById('sidebarPrestige').textContent = prestige;
    document.getElementById('sidebarRank').textContent = rank;
}

// Initialize social feed
document.addEventListener('DOMContentLoaded', function() {
    // Load saved posts from localStorage
    loadPostsFromStorage();
    
    // Update sidebar when user data is loaded
    setTimeout(updateSocialSidebar, 500);
    
    // Close modal when clicking outside
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('createPostModal');
        if (event.target === modal) {
            closeCreatePostModal();
        }
    });
});

// Handle follow buttons
document.addEventListener('click', function(event) {
    if (event.target.classList.contains('btn-follow') || event.target.closest('.btn-follow')) {
        const btn = event.target.classList.contains('btn-follow') ? event.target : event.target.closest('.btn-follow');
        
        if (btn.textContent === 'Follow') {
            btn.textContent = 'Following';
            btn.style.background = '#e0e0e0';
            btn.style.color = '#666';
            showNotification('Now following this user!');
        } else {
            btn.textContent = 'Follow';
            btn.style.background = 'darkolivegreen';
            btn.style.color = 'white';
        }
    }
});

// Simulate live feed updates
function simulateLiveFeed() {
    const liveActivities = [
        { user: 'Player123', action: 'earned 50 pts' },
        { user: 'ProGamer', action: 'completed challenge' },
        { user: 'Champion', action: 'reached Gold Tier' },
        { user: 'ElitePlayer', action: 'won tournament' },
        { user: 'RisingStar', action: 'joined alliance' },
        { user: 'Legend', action: 'earned 100 pts' }
    ];
    
    setInterval(() => {
        const liveFeed = document.querySelector('.live-feed');
        if (!liveFeed) return;
        
        const randomActivity = liveActivities[Math.floor(Math.random() * liveActivities.length)];
        
        const liveItem = document.createElement('div');
        liveItem.className = 'live-item';
        liveItem.style.animation = 'fadeIn 0.5s';
        liveItem.innerHTML = `
            <span class="live-dot"></span>
            <div class="live-info">
                <strong>${randomActivity.user}</strong> ${randomActivity.action}
                <span class="live-time">Just now</span>
            </div>
        `;
        
        // Insert at the beginning
        liveFeed.insertBefore(liveItem, liveFeed.firstChild);
        
        // Keep only last 5 items
        while (liveFeed.children.length > 5) {
            liveFeed.removeChild(liveFeed.lastChild);
        }
    }, 15000); // Update every 15 seconds
}

// Start live feed simulation
setTimeout(simulateLiveFeed, 5000);

// Story Creation Functions
function createStory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            // Create story card
            const storiesContainer = document.querySelector('.stories-container');
            const storyCard = document.createElement('div');
            storyCard.className = 'story-card';
            storyCard.style.animation = 'fadeIn 0.5s';
            
            const isVideo = file.type.startsWith('video/');
            
            storyCard.innerHTML = `
                <div class="story-image" style="background: url('${!isVideo ? event.target.result : ''}') center/cover;">
                    ${isVideo ? `<video src="${event.target.result}" style="width:100%;height:100%;object-fit:cover;"></video>` : ''}
                </div>
                <span class="story-name">Your Story</span>
            `;
            
            // Insert after "Create Story" card
            const createCard = storiesContainer.querySelector('.create-story');
            if (createCard.nextSibling) {
                storiesContainer.insertBefore(storyCard, createCard.nextSibling);
            } else {
                storiesContainer.appendChild(storyCard);
            }
            
            showNotification('Story posted successfully! 🎉');
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// Comment Modal Functions
function openCommentModal(postId) {
    const modal = document.getElementById('commentModal');
    if (!modal) {
        // Create comment modal if it doesn't exist
        createCommentModal();
    }
    
    const modalEl = document.getElementById('commentModal');
    modalEl.style.display = 'block';
    modalEl.setAttribute('data-post-id', postId);
    
    // Load existing comments for this post
    loadComments(postId);
    
    // Focus on comment input
    setTimeout(() => {
        document.getElementById('commentInput').focus();
    }, 100);
}

function closeCommentModal() {
    const modal = document.getElementById('commentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    
    // Clear comment input
    const commentInput = document.getElementById('commentInput');
    if (commentInput) {
        commentInput.value = '';
    }
}

function createCommentModal() {
    const modalHTML = `
        <div id="commentModal" class="modal">
            <div class="modal-content comment-modal-content">
                <div class="modal-header">
                    <h2>Comments</h2>
                    <span class="close" onclick="closeCommentModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div id="commentsList" class="comments-list">
                        <p class="no-comments">No comments yet. Be the first to comment!</p>
                    </div>
                    <div class="comment-input-container">
                        <div class="comment-avatar">
                            <i class="fas fa-user-circle"></i>
                        </div>
                        <input type="text" id="commentInput" class="comment-input" placeholder="Write a comment...">
                        <button class="comment-submit-btn" onclick="submitComment()">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Close modal when clicking outside
    const modal = document.getElementById('commentModal');
    modal.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeCommentModal();
        }
    });
}

function loadComments(postId) {
    const commentsList = document.getElementById('commentsList');
    
    // Try to load comments from localStorage
    let allComments = JSON.parse(localStorage.getItem('postComments') || '{}');
    let postComments = allComments[postId] || [];
    
    if (postComments.length === 0) {
        commentsList.innerHTML = '<p class="no-comments">No comments yet. Be the first to comment!</p>';
        return;
    }
    
    commentsList.innerHTML = postComments.map(comment => `
        <div class="comment-item">
            <div class="comment-avatar">
                <i class="fas fa-user-circle"></i>
            </div>
            <div class="comment-content">
                <div class="comment-header">
                    <span class="comment-author">${comment.username}</span>
                    <span class="comment-time">${getTimeAgo(comment.timestamp)}</span>
                </div>
                <p class="comment-text">${comment.text}</p>
            </div>
        </div>
    `).join('');
}

function submitComment() {
    const commentInput = document.getElementById('commentInput');
    const text = commentInput.value.trim();
    
    if (!text) {
        alert('Please enter a comment');
        return;
    }
    
    const modal = document.getElementById('commentModal');
    const postId = modal.getAttribute('data-post-id');
    
    // Get username
    const usernameEl = document.getElementById('username') || 
                       document.getElementById('userMenuName') || 
                       document.getElementById('sidebarUsername');
    const username = usernameEl ? usernameEl.textContent : 'Player';
    
    // Create comment object
    const comment = {
        id: Date.now(),
        username: username,
        text: text,
        timestamp: new Date().toISOString()
    };
    
    // Save to localStorage
    let allComments = JSON.parse(localStorage.getItem('postComments') || '{}');
    if (!allComments[postId]) {
        allComments[postId] = [];
    }
    allComments[postId].push(comment);
    localStorage.setItem('postComments', JSON.stringify(allComments));
    
    // Reload comments
    loadComments(postId);
    
    // Clear input
    commentInput.value = '';
    
    // Update comment count on post
    updateCommentCount(postId, allComments[postId].length);
    
    showNotification('Comment posted successfully!');
}

function updateCommentCount(postId, count) {
    const postCard = document.querySelector(`[data-post-id="${postId}"]`);
    if (postCard) {
        const statsEl = postCard.querySelector('.post-stats span:last-child');
        if (statsEl) {
            const currentText = statsEl.textContent;
            const match = currentText.match(/(\d+)\s*comments/);
            if (match) {
                statsEl.innerHTML = `${count} comments · ${currentText.split('·')[1] || '0 shares'}`;
            }
        }
    }
}

// Share Modal Functions
function openShareModal(postId) {
    const modal = document.getElementById('shareModal');
    if (!modal) {
        // Create share modal if it doesn't exist
        createShareModal();
    }
    
    const modalEl = document.getElementById('shareModal');
    modalEl.style.display = 'block';
    modalEl.setAttribute('data-post-id', postId);
    
    // Generate share URLs
    generateShareUrls(postId);
}

function closeShareModal() {
    const modal = document.getElementById('shareModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function createShareModal() {
    const modalHTML = `
        <div id="shareModal" class="modal">
            <div class="modal-content share-modal-content">
                <div class="modal-header">
                    <h2>Share Post</h2>
                    <span class="close" onclick="closeShareModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="share-platforms">
                        <button class="share-platform-btn facebook" onclick="shareToFacebook()">
                            <i class="fab fa-facebook-f"></i>
                            <span>Facebook</span>
                        </button>
                        <button class="share-platform-btn whatsapp" onclick="shareToWhatsApp()">
                            <i class="fab fa-whatsapp"></i>
                            <span>WhatsApp</span>
                        </button>
                        <button class="share-platform-btn twitter" onclick="shareToTwitter()">
                            <i class="fab fa-twitter"></i>
                            <span>Twitter/X</span>
                        </button>
                        <button class="share-platform-btn instagram" onclick="shareToInstagram()">
                            <i class="fab fa-instagram"></i>
                            <span>Instagram</span>
                        </button>
                        <button class="share-platform-btn copy" onclick="copyLink()">
                            <i class="fas fa-link"></i>
                            <span>Copy Link</span>
                        </button>
                    </div>
                    <div class="share-preview">
                        <p class="share-url-preview" id="shareUrlPreview"></p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Close modal when clicking outside
    const modal = document.getElementById('shareModal');
    modal.addEventListener('click', function(event) {
        if (event.target === modal) {
            closeShareModal();
        }
    });
}

function generateShareUrls(postId) {
    // Generate a shareable URL (in production, this would be the actual post URL)
    const shareUrl = `${window.location.origin}/posts/${postId}`;
    document.getElementById('shareUrlPreview').textContent = shareUrl;
    
    // Store the share URL for platform sharing
    window.currentShareUrl = shareUrl;
    window.currentShareText = 'Check out this post on ARTX!';
}

function shareToFacebook() {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.currentShareUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
    closeShareModal();
    showNotification('Opening Facebook share...');
}

function shareToWhatsApp() {
    const url = `https://wa.me/?text=${encodeURIComponent(window.currentShareText + ' ' + window.currentShareUrl)}`;
    window.open(url, '_blank');
    closeShareModal();
    showNotification('Opening WhatsApp share...');
}

function shareToTwitter() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(window.currentShareText)}&url=${encodeURIComponent(window.currentShareUrl)}`;
    window.open(url, '_blank', 'width=600,height=400');
    closeShareModal();
    showNotification('Opening Twitter share...');
}

function shareToInstagram() {
    // Instagram doesn't have direct web sharing, so we copy the link
    copyLink();
    showNotification('Instagram doesn\'t support direct sharing. Link copied!');
    closeShareModal();
}

function copyLink() {
    navigator.clipboard.writeText(window.currentShareUrl).then(() => {
        showNotification('Link copied to clipboard!');
        closeShareModal();
    }).catch(err => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = window.currentShareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('Link copied to clipboard!');
        closeShareModal();
    });
}

// Add click handler for create story
document.addEventListener('DOMContentLoaded', function() {
    const createStoryCard = document.querySelector('.create-story');
    if (createStoryCard) {
        createStoryCard.addEventListener('click', createStory);
    }
});


// ========================================
// STORIES HORIZONTAL SCROLL ENHANCEMENT
// ========================================

// Function to update scroll indicators
function updateScrollIndicators() {
    const container = document.querySelector('.stories-container');
    if (!container) return;
    
    const hasScroll = container.scrollWidth > container.clientWidth;
    const isAtStart = container.scrollLeft <= 5;
    const isAtEnd = container.scrollLeft >= (container.scrollWidth - container.clientWidth - 5);
    
    // Add or remove scroll classes
    if (hasScroll) {
        container.classList.add('has-scroll');
        
        // Show left fade indicator if not at start
        if (!isAtStart) {
            container.classList.add('has-scroll-start');
        } else {
            container.classList.remove('has-scroll-start');
        }
        
        // Hide right fade indicator if at end
        if (isAtEnd) {
            container.classList.remove('has-scroll');
        }
    } else {
        container.classList.remove('has-scroll');
        container.classList.remove('has-scroll-start');
    }
}

// Function to enable smooth momentum scrolling
function enableSmoothScroll() {
    const container = document.querySelector('.stories-container');
    if (!container) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;
    let velocity = 0;
    let lastX = 0;
    let lastTime = Date.now();
    
    container.addEventListener('mousedown', (e) => {
        isDown = true;
        container.style.cursor = 'grabbing';
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
        velocity = 0;
        lastX = e.pageX;
        lastTime = Date.now();
    });
    
    container.addEventListener('mouseleave', () => {
        isDown = false;
        container.style.cursor = 'grab';
    });
    
    container.addEventListener('mouseup', () => {
        isDown = false;
        container.style.cursor = 'grab';
        
        // Apply momentum
        if (Math.abs(velocity) > 0.5) {
            let momentum = velocity;
            const deceleration = 0.95;
            
            function glide() {
                momentum *= deceleration;
                container.scrollLeft -= momentum;
                
                if (Math.abs(momentum) > 0.5) {
                    requestAnimationFrame(glide);
                }
            }
            glide();
        }
    });
    
    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 1.5; // Scroll speed multiplier
        container.scrollLeft = scrollLeft - walk;
        
        // Calculate velocity for momentum
        const now = Date.now();
        const dt = now - lastTime;
        if (dt > 0) {
            velocity = (e.pageX - lastX) / dt * 16; // Normalize to 60fps
        }
        lastX = e.pageX;
        lastTime = now;
    });
    
    // Set initial cursor
    container.style.cursor = 'grab';
}

// Function to add keyboard navigation
function enableKeyboardNavigation() {
    const container = document.querySelector('.stories-container');
    if (!container) return;
    
    // Make container focusable
    container.setAttribute('tabindex', '0');
    
    container.addEventListener('keydown', (e) => {
        const scrollAmount = 200;
        
        switch(e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                break;
            case 'ArrowRight':
                e.preventDefault();
                container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                break;
            case 'Home':
                e.preventDefault();
                container.scrollTo({ left: 0, behavior: 'smooth' });
                break;
            case 'End':
                e.preventDefault();
                container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
                break;
        }
    });
}

// Initialize horizontal scroll features
function initializeStoriesScroll() {
    const container = document.querySelector('.stories-container');
    if (!container) return;
    
    // Update indicators on scroll
    container.addEventListener('scroll', updateScrollIndicators);
    
    // Update on window resize
    window.addEventListener('resize', updateScrollIndicators);
    
    // Enable smooth drag scrolling (desktop only)
    if (window.innerWidth >= 768) {
        enableSmoothScroll();
    }
    
    // Enable keyboard navigation
    enableKeyboardNavigation();
    
    // Initial update
    updateScrollIndicators();
    
    // Show scroll hint on mobile (once)
    if (window.innerWidth < 768 && !localStorage.getItem('storiesScrollHintShown')) {
        setTimeout(() => {
            container.classList.add('show-hint');
            setTimeout(() => {
                container.classList.remove('show-hint');
                localStorage.setItem('storiesScrollHintShown', 'true');
            }, 2000);
        }, 1000);
    }
    
    // Update when stories are added/removed
    const observer = new MutationObserver(updateScrollIndicators);
    observer.observe(container, { childList: true });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeStoriesScroll);
} else {
    initializeStoriesScroll();
}
