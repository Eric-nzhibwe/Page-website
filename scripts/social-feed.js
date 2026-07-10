/**
 * ARTX Social Feed
 * Handles: create post modal, publish post (API-first), story creation,
 * post menu, delete, sidebar, stories scroll, dashboard nav.
 *
 * NOTE: comment / share / react / follow are handled by social-features.js
 * and realtime-updates.js which load AFTER this file.
 * socialToast() is therefore NOT available here at definition time —
 * we call it via a safe wrapper that delays until it exists.
 */

'use strict';

// ─── Safe toast (works even before social-features.js loads) ─────────────────
function _feedToast(msg, type) {
    // social-features.js defines socialToast and loads after us.
    // By the time the user triggers any action, all scripts are loaded.
    if (typeof socialToast === 'function') { socialToast(msg, type); return; }
    // Fallback: queue for next tick in case we're called during DOMContentLoaded
    setTimeout(() => {
        if (typeof socialToast === 'function') socialToast(msg, type);
    }, 50);
}

// ─── Tiny escape helper ───────────────────────────────────────────────────────
function _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function _timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7)  return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

function _currentUsername() {
    try { return JSON.parse(localStorage.getItem('artxUser') || '{}').username || 'You'; }
    catch { return 'You'; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  DASHBOARD NAV
// ─────────────────────────────────────────────────────────────────────────────
function toggleDashboardMenu() {
    const d = document.getElementById('dashboardDropdown');
    if (d) d.classList.toggle('show');
}

window.addEventListener('click', e => {
    if (!e.target.matches('.btn-dashboard-toggle') && !e.target.closest('.btn-dashboard-toggle')) {
        document.querySelectorAll('.dashboard-dropdown-content.show')
            .forEach(el => el.classList.remove('show'));
    }
});

function showDashboardView() {
    document.getElementById('social-feed')?.classList.remove('active');
    document.getElementById('dashboard')?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-view') === 'dashboard');
    });
}

function scrollToSection(id) {
    showDashboardView();
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE POST MODAL
// ─────────────────────────────────────────────────────────────────────────────
let _selectedMedia     = null;
let _selectedMediaType = null;

function openCreatePostModal(type = null) {
    const modal = document.getElementById('createPostModal');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('modal--open'));

    // Populate creator name from loaded user
    const name = document.getElementById('userMenuName')?.textContent
              || document.getElementById('sidebarUsername')?.textContent
              || _currentUsername();
    const nameEl = document.getElementById('postCreatorName');
    if (nameEl) nameEl.textContent = name;

    if (type === 'photo')       triggerMediaUpload('image');
    else if (type === 'video')  triggerMediaUpload('video');
    else if (type === 'achievement') addAchievement();
}

function closeCreatePostModal() {
    const modal = document.getElementById('createPostModal');
    if (!modal) return;
    modal.classList.remove('modal--open');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
    const ta = document.getElementById('postContent');
    if (ta) ta.value = '';
    removePostMedia();
}

function triggerMediaUpload(type) {
    const input = document.getElementById('mediaUploadInput');
    if (!input) return;
    input.accept   = type === 'image' ? 'image/*' : 'video/*';
    input.multiple = type === 'image';
    input.click();
}

function handleMediaUpload(event) {
    const files   = event.target.files;
    if (!files?.length) return;
    const preview = document.getElementById('postMediaPreview');
    const content = document.getElementById('mediaPreviewContent');
    content.innerHTML = '';

    Array.from(files).forEach((file, i) => {
        const reader = new FileReader();
        if (file.type.startsWith('image/')) {
            _selectedMedia = file; _selectedMediaType = 'image';
            reader.onload = e => {
                const div = document.createElement('div');
                div.className = 'media-preview-item';
                div.innerHTML = `<img src="${e.target.result}" alt="Preview ${i+1}">
                    <button class="remove-media-btn" onclick="removeMediaItem(${i})">
                        <i class="fas fa-times"></i></button>`;
                content.appendChild(div);
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
            _selectedMedia = file; _selectedMediaType = 'video';
            reader.onload = e => {
                content.innerHTML = `<div class="media-preview-item video-preview">
                    <video src="${e.target.result}" controls></video>
                    <button class="remove-media-btn" onclick="removePostMedia()">
                        <i class="fas fa-times"></i></button></div>`;
            };
            reader.readAsDataURL(file);
        }
    });
    if (preview) preview.style.display = 'block';
}

function removeMediaItem(index) {
    const preview = document.getElementById('postMediaPreview');
    const items   = preview?.querySelectorAll('.media-preview-item');
    if (items?.[index]) items[index].remove();
    if (!preview?.querySelectorAll('.media-preview-item').length) {
        if (preview) preview.style.display = 'none';
        _selectedMedia = _selectedMediaType = null;
    }
}

function removePostMedia() {
    _selectedMedia = _selectedMediaType = null;
    const preview = document.getElementById('postMediaPreview');
    const content = document.getElementById('mediaPreviewContent');
    const input   = document.getElementById('mediaUploadInput');
    if (preview) preview.style.display = 'none';
    if (content) content.innerHTML     = '';
    if (input)   input.value           = '';
}

function addAchievement() {
    _selectedMediaType = 'achievement';
    const content = document.getElementById('mediaPreviewContent');
    const preview = document.getElementById('postMediaPreview');
    if (content) content.innerHTML = `
        <div class="achievement-badge-large">
            <i class="fas fa-trophy"></i>
            <h3>Achievement Unlocked!</h3>
            <p>Share your success</p>
        </div>`;
    if (preview) preview.style.display = 'block';
}

function addLocation() {
    const ta = document.getElementById('postContent');
    if (!ta) return;
    ta.value = (ta.value ? ta.value + '\n' : '') + '📍 My Location';
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLISH POST  (API-first, localStorage fallback)
// ─────────────────────────────────────────────────────────────────────────────
const _POST_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api/social/posts/'
    : `${window.location.origin}/api/social/posts/`;

function publishPost() {
    const content = (document.getElementById('postContent')?.value || '').trim();
    if (!content && !_selectedMedia) {
        _feedToast('Add some text or media before posting.', 'info');
        return;
    }

    const btn = document.querySelector('#createPostModal .btn-post');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Posting…'; }

    // Collect local media previews
    const mediaItems = document.querySelectorAll('#mediaPreviewContent .media-preview-item');
    const mediaData  = [];
    mediaItems.forEach(item => {
        const img   = item.querySelector('img');
        const video = item.querySelector('video');
        if (img)   mediaData.push({ type: 'image', src: img.src });
        if (video) mediaData.push({ type: 'video', src: video.src });
    });
    if (_selectedMediaType === 'achievement' && !mediaItems.length) {
        mediaData.push({ type: 'achievement' });
    }

    const post_type = mediaData[0]?.type === 'achievement' ? 'achievement'
                    : mediaData.length ? 'media' : 'text';
    const token = localStorage.getItem('djangoAuthToken');

    const doPost = token
        ? fetch(_POST_API, {
            method:  'POST',
            headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ content, post_type })
          }).then(r => r.ok ? r.json() : Promise.reject(r.status))
        : Promise.reject('no_token');

    doPost
        .then(apiPost => {
            if (mediaData.length) apiPost._localMedia = mediaData;
            _insertPostCard(apiPost);
            closeCreatePostModal();
            _feedToast('Post published! 🎉', 'success');
        })
        .catch(() => {
            // Offline / no token — save locally, show immediately
            const local = {
                id: `local-${Date.now()}`,
                content, post_type,
                _localMedia: mediaData,
                author:      { username: _currentUsername() },
                created_at:  new Date().toISOString(),
                reaction_count: 0, comment_count: 0, share_count: 0
            };
            _saveLocalPost(local);
            _insertPostCard(local);
            closeCreatePostModal();
            _feedToast('Post saved locally — will sync when online.', 'info');
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post'; }
        });
}

/** Build and prepend a post card to the feed */
function _insertPostCard(post) {
    const container = document.getElementById('feedPosts');
    if (!container) return;

    const author = post.author || {};
    const name   = _esc(author.display_name || author.username || _currentUsername());
    const media  = post._localMedia || post.media || [];
    const when   = post.created_at ? _timeAgo(post.created_at) : 'Just now';

    const avatarHTML_str = (typeof avatarHTML === 'function')
        ? avatarHTML(author)
        : (author.profile_image
            ? `<img src="${_esc(author.profile_image)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : `<i class="fas fa-user-circle"></i>`);

    let mediaHTML = '';
    if (media[0]?.type === 'achievement') {
        mediaHTML = `<div class="post-media"><div class="achievement-badge-large">
            <i class="fas fa-trophy"></i><h3>Achievement Unlocked!</h3>
            <p>Shared your success</p></div></div>`;
    } else if (media.length) {
        mediaHTML = '<div class="post-media"><div class="post-media-grid">';
        media.forEach((m, i) => {
            if (m.type === 'image')
                mediaHTML += `<div class="post-media-item"><img src="${_esc(m.src)}" alt="Post image ${i+1}" loading="lazy"></div>`;
            else if (m.type === 'video')
                mediaHTML += `<div class="post-media-item video-item"><video src="${_esc(m.src)}" controls></video></div>`;
        });
        mediaHTML += '</div></div>';
    } else if (post.media_url) {
        mediaHTML = post.media_type === 'video'
            ? `<div class="post-media"><video controls><source src="${_esc(post.media_url)}"></video></div>`
            : `<div class="post-media"><img src="${_esc(post.media_url)}" alt="Post media" loading="lazy"></div>`;
    }

    const card = document.createElement('div');
    card.className = 'post-card post-card--new';
    card.setAttribute('data-post-id', post.id);
    card.innerHTML = `
        <div class="post-header">
            <div class="post-author">
                <div class="post-avatar">${avatarHTML}</div>
                <div class="post-author-info">
                    <h4>${name}</h4>
                    <span class="post-time">${when}</span>
                </div>
            </div>
            <button class="post-menu-btn" onclick="showPostMenu('${post.id}', event)">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
        <div class="post-content"><p>${_esc(post.content)}</p></div>
        ${mediaHTML}
        <div class="post-stats">
            <span><i class="fas fa-fire"></i>
                <span class="reaction-count">${post.reaction_count ?? 0}</span> reactions</span>
            <span><span class="comment-count">${post.comment_count ?? 0}</span> comments
                · <span class="share-count">${post.share_count ?? 0}</span> shares</span>
        </div>
        <div class="post-actions">
            <button class="post-action-btn${post.user_reaction ? ' reacted' : ''}"
                onclick="reactToPost('${post.id}', 'fire')">
                <i class="fas fa-fire"></i><span>React</span>
            </button>
            <button class="post-action-btn" onclick="openCommentModal('${post.id}')">
                <i class="fas fa-comment"></i><span>Comment</span>
            </button>
            <button class="post-action-btn" onclick="openShareModal('${post.id}')">
                <i class="fas fa-share"></i><span>Share</span>
            </button>
        </div>
        <div class="post-comments"></div>`;

    container.insertBefore(card, container.firstChild);
}

function _saveLocalPost(post) {
    const posts = JSON.parse(localStorage.getItem('userPosts') || '[]');
    posts.unshift(post);
    localStorage.setItem('userPosts', JSON.stringify(posts.slice(0, 50)));
}

/** Load any locally-saved posts on startup (shown until API posts arrive) */
function _loadLocalPosts() {
    const posts     = JSON.parse(localStorage.getItem('userPosts') || '[]');
    const container = document.getElementById('feedPosts');
    if (!container || !posts.length) return;

    // Only show local posts that aren't already rendered (e.g. from API poll)
    posts.forEach(p => {
        if (!container.querySelector(`[data-post-id="${p.id}"]`)) {
            _insertPostCard(p);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST MENU (⋯ dropdown)
// ─────────────────────────────────────────────────────────────────────────────
function showPostMenu(postId, event) {
    // Remove any existing menu
    document.querySelectorAll('.post-menu-dropdown').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'post-menu-dropdown';
    menu.innerHTML = `
        <button onclick="deletePost('${postId}')">
            <i class="fas fa-trash"></i> Delete Post
        </button>
        <button onclick="copyPostLink('${postId}')">
            <i class="fas fa-link"></i> Copy Link
        </button>`;

    const btn  = event?.target?.closest('.post-menu-btn');
    const rect = btn?.getBoundingClientRect();
    if (rect) {
        menu.style.cssText = `position:fixed;top:${rect.bottom + 6}px;
            right:${window.innerWidth - rect.right}px;z-index:1200`;
    }
    document.body.appendChild(menu);

    setTimeout(() => {
        document.addEventListener('click', function close(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', close); }
        });
    }, 50);
}

function deletePost(postId) {
    if (!confirm('Delete this post?')) return;

    // Remove from local storage
    const posts = JSON.parse(localStorage.getItem('userPosts') || '[]')
        .filter(p => String(p.id) !== String(postId));
    localStorage.setItem('userPosts', JSON.stringify(posts));

    // Try API delete
    const token = localStorage.getItem('djangoAuthToken');
    const API   = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8000/api' : `${window.location.origin}/api`;
    if (token) {
        fetch(`${API}/social/posts/${postId}/`, {
            method:  'DELETE',
            headers: { 'Authorization': `Token ${token}` }
        }).catch(() => {});
    }

    const card = document.querySelector(`[data-post-id="${postId}"]`);
    if (card) {
        card.style.transition = 'opacity .3s, transform .3s';
        card.style.opacity    = '0';
        card.style.transform  = 'scale(.97)';
        setTimeout(() => card.remove(), 300);
    }
    _feedToast('Post deleted.', 'info');
}

function copyPostLink(postId) {
    const url = `${window.location.origin}/posts/${postId}`;
    navigator.clipboard?.writeText(url)
        .then(() => _feedToast('Link copied! 🔗', 'success'))
        .catch(()  => _feedToast('Could not copy link.', 'error'));
}

// ─────────────────────────────────────────────────────────────────────────────
//  SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function updateSocialSidebar() {
    try {
        const user = JSON.parse(localStorage.getItem('artxUser') || '{}');
        const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set('sidebarUsername', user.username || 'Player');
        set('sidebarTier',     (user.access_tier || 'Bronze') + ' Tier');
        set('sidebarPrestige', user.prestige_points ?? 0);
    } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  STORY CREATION
// ─────────────────────────────────────────────────────────────────────────────
function openCreateStoryModal() { createStory(); }

function createStory() {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*,video/*';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const isVideo = file.type.startsWith('video/');
            const card    = document.createElement('div');
            card.className = 'story-card';
            card.style.animation = 'fadeInCard .4s ease';

            const storyData = [{
                id:          `local-story-${Date.now()}`,
                author:      { username: _currentUsername(), display_name: _currentUsername(), profile_image: null },
                media_url:   ev.target.result,
                media_type:  isVideo ? 'video' : 'image',
                content:     '',
                view_count:  0,
                created_at:  new Date().toISOString(),
                expires_at:  new Date(Date.now() + 86400000).toISOString(),
                time_until_expiry: 86400
            }];

            card.innerHTML = `
                <div class="story-image" style="${!isVideo ? `background:url('${ev.target.result}') center/cover` : ''}">
                    ${isVideo ? `<video src="${ev.target.result}" style="width:100%;height:100%;object-fit:cover"></video>` : ''}
                </div>
                <span class="story-name">Your Story</span>`;

            card.onclick = () => storyViewer?.openStory(storyData[0].id, storyData);

            const container  = document.querySelector('.stories-container');
            const createCard = container?.querySelector('.create-story');
            if (createCard?.nextSibling) container.insertBefore(card, createCard.nextSibling);
            else container?.appendChild(card);

            _feedToast('Story posted! 🎉', 'success');
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// ─────────────────────────────────────────────────────────────────────────────
//  LIVE COMPETITION FEED (sidebar animation)
// ─────────────────────────────────────────────────────────────────────────────
function _startLiveFeedTicker() {
    const activities = [
        { user: 'Player123',   action: 'earned 50 pts' },
        { user: 'ProGamer',    action: 'completed a challenge' },
        { user: 'Champion',    action: 'reached Gold Tier' },
        { user: 'ElitePlayer', action: 'won a tournament' },
        { user: 'RisingStar',  action: 'joined an alliance' },
        { user: 'Legend',      action: 'earned 100 pts' }
    ];

    setInterval(() => {
        const feed = document.querySelector('.live-feed');
        if (!feed) return;
        const act  = activities[Math.floor(Math.random() * activities.length)];
        const item = document.createElement('div');
        item.className = 'live-item';
        item.style.animation = 'fadeInCard .4s ease';
        item.innerHTML = `
            <span class="live-dot"></span>
            <div class="live-info">
                <strong>${act.user}</strong> ${act.action}
                <span class="live-time">Just now</span>
            </div>`;
        feed.insertBefore(item, feed.firstChild);
        while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    }, 15_000);
}

// ─────────────────────────────────────────────────────────────────────────────
//  STORIES HORIZONTAL SCROLL
// ─────────────────────────────────────────────────────────────────────────────
function _initStoriesScroll() {
    const container = document.querySelector('.stories-container');
    if (!container) return;

    const update = () => {
        const canScroll = container.scrollWidth > container.clientWidth;
        const atStart   = container.scrollLeft <= 5;
        const atEnd     = container.scrollLeft >= container.scrollWidth - container.clientWidth - 5;
        container.classList.toggle('has-scroll',       canScroll && !atEnd);
        container.classList.toggle('has-scroll-start', canScroll && !atStart);
    };

    container.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    new MutationObserver(update).observe(container, { childList: true });
    update();

    // Drag-to-scroll on desktop
    if (window.innerWidth >= 768) {
        let down = false, startX, scrollLeft, vx = 0, lx = 0, lt = 0;
        container.style.cursor = 'grab';

        container.addEventListener('mousedown',  e => {
            down = true; container.style.cursor = 'grabbing';
            startX = e.pageX - container.offsetLeft;
            scrollLeft = container.scrollLeft;
            vx = 0; lx = e.pageX; lt = Date.now();
        });
        container.addEventListener('mouseleave', () => { down = false; container.style.cursor = 'grab'; });
        container.addEventListener('mouseup',    () => {
            down = false; container.style.cursor = 'grab';
            let m = vx;
            (function glide() {
                m *= 0.94; container.scrollLeft -= m;
                if (Math.abs(m) > 0.5) requestAnimationFrame(glide);
            })();
        });
        container.addEventListener('mousemove', e => {
            if (!down) return; e.preventDefault();
            container.scrollLeft = scrollLeft - (e.pageX - container.offsetLeft - startX) * 1.5;
            const now = Date.now(), dt = now - lt;
            if (dt > 0) vx = (e.pageX - lx) / dt * 16;
            lx = e.pageX; lt = now;
        });
    }

    // Keyboard nav
    container.setAttribute('tabindex', '0');
    container.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); container.scrollBy({ left: -200, behavior: 'smooth' }); }
        if (e.key === 'ArrowRight') { e.preventDefault(); container.scrollBy({ left:  200, behavior: 'smooth' }); }
    });

    // One-time scroll hint on mobile
    if (window.innerWidth < 768 && !localStorage.getItem('storiesHintShown')) {
        setTimeout(() => {
            container.classList.add('show-hint');
            setTimeout(() => {
                container.classList.remove('show-hint');
                localStorage.setItem('storiesHintShown', '1');
            }, 2000);
        }, 1200);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  REAL-TIME FEED & STORIES LOADER
// ─────────────────────────────────────────────────────────────────────────────

const _SOCIAL_API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api/social'
    : `${window.location.origin}/api/social`;

let _feedPage        = 1;
let _feedLoading     = false;
let _feedExhausted   = false;

/**
 * Fetch real posts from the API and render them.
 * Clears the loading spinner on first load.
 */
async function loadRealFeed(page = 1) {
    if (_feedLoading || _feedExhausted) return;
    _feedLoading = true;

    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { _feedLoading = false; return; }

    try {
        const res  = await fetch(`${_SOCIAL_API}/posts/?page=${page}`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();

        const container = document.getElementById('feedPosts');
        if (!container) return;

        // Remove loading spinner on first page
        if (page === 1) {
            const spinner = container.querySelector('.feed-loading');
            if (spinner) spinner.remove();
        }

        const posts = data.results || data;
        if (!posts.length && page === 1) {
            container.innerHTML = `
                <div class="feed-empty">
                    <i class="fas fa-users" style="font-size:48px;opacity:.3;margin-bottom:12px;"></i>
                    <p>No posts yet. Follow people or create your first post!</p>
                </div>`;
            _feedExhausted = true;
            return;
        }

        posts.forEach(post => {
            // Don't duplicate
            if (!container.querySelector(`[data-post-id="${post.id}"]`)) {
                _appendPostCard(post, container);
            }
        });

        // Check if more pages exist
        if (!data.next) _feedExhausted = true;
        _feedPage = page + 1;

    } catch (err) {
        console.warn('Feed load error:', err);
        // Show locally saved posts as fallback
        _loadLocalPosts();
    } finally {
        _feedLoading = false;
    }
}

/** Append (not prepend) a post card — used for pagination */
function _appendPostCard(post, container) {
    const author = post.author || {};
    const name   = _esc(author.display_name || author.username || 'User');
    const when   = post.created_at ? _timeAgo(post.created_at) : 'Just now';

    const avatarHTML_str = (typeof avatarHTML === 'function')
        ? avatarHTML(author)
        : (author.profile_image
            ? `<img src="${_esc(author.profile_image)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
            : `<i class="fas fa-user-circle"></i>`);

    let mediaHTML = '';
    if (post.media_url) {
        mediaHTML = post.media_type === 'video'
            ? `<div class="post-media"><video controls>
                   <source src="${_esc(post.media_url)}"></video></div>`
            : `<div class="post-media">
                   <img src="${_esc(post.media_url)}" alt="Post media" loading="lazy"></div>`;
    }

    const card = document.createElement('div');
    card.className = 'post-card';
    card.setAttribute('data-post-id', post.id);
    card.innerHTML = `
        <div class="post-header">
            <div class="post-author">
                <div class="post-avatar">${avatarHTML}</div>
                <div class="post-author-info">
                    <h4>${name}</h4>
                    <span class="post-time">${when}</span>
                </div>
            </div>
            <button class="post-menu-btn" onclick="showPostMenu('${post.id}', event)">
                <i class="fas fa-ellipsis-h"></i>
            </button>
        </div>
        <div class="post-content"><p>${_esc(post.content || '')}</p></div>
        ${mediaHTML}
        <div class="post-stats">
            <span><i class="fas fa-fire"></i>
                <span class="reaction-count">${post.reaction_count ?? 0}</span> reactions</span>
            <span>
                <span class="comment-count">${post.comment_count ?? 0}</span> comments ·
                <span class="share-count">${post.share_count ?? 0}</span> shares
            </span>
        </div>
        <div class="post-actions">
            <button class="post-action-btn${post.user_reaction ? ' reacted' : ''}"
                onclick="reactToPost('${post.id}', 'fire')">
                <i class="fas fa-fire"></i><span>React</span>
            </button>
            <button class="post-action-btn" onclick="openCommentModal('${post.id}')">
                <i class="fas fa-comment"></i><span>Comment</span>
            </button>
            <button class="post-action-btn" onclick="openShareModal('${post.id}')">
                <i class="fas fa-share"></i><span>Share</span>
            </button>
        </div>
        <div class="post-comments"></div>`;
    container.appendChild(card);
}

/**
 * Fetch real stories from the API and render them in the stories bar.
 */
async function loadRealStories() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return;

    try {
        const res  = await fetch(`${_SOCIAL_API}/stories/feed/`, {
            headers: { 'Authorization': `Token ${token}` }
        });
        if (!res.ok) throw new Error(res.status);
        const stories = await res.json();

        const container  = document.querySelector('.stories-container');
        if (!container) return;

        // Remove any existing real story cards (keep the "Add Story" card)
        container.querySelectorAll('.story-card:not(.create-story)').forEach(c => c.remove());

        if (!stories.length) return;

        // Group stories by author
        const byAuthor = {};
        stories.forEach(s => {
            const uid = s.author?.id || s.author?.username;
            if (!byAuthor[uid]) byAuthor[uid] = { author: s.author, stories: [] };
            byAuthor[uid].stories.push(s);
        });

        Object.values(byAuthor).forEach(({ author, stories: authorStories }) => {
            const name   = _esc(author.display_name || author.username || 'User');
            const card   = document.createElement('div');
            card.className = 'story-card flex-shrink-0';

            const avatarStyle = author.profile_image
                ? `background:url('${_esc(author.profile_image)}') center/cover`
                : `background:linear-gradient(135deg,#6c63ff,#3b2dbf)`;

            const avatarContent = author.profile_image
                ? '' : `<i class="fas fa-user"></i>`;

            card.innerHTML = `
                <div class="story-image" style="${avatarStyle}">
                    ${avatarContent}
                    <div class="story-ring"></div>
                </div>
                <span class="story-name">${name}</span>`;

            card.addEventListener('click', () => {
                if (typeof storyViewer !== 'undefined') {
                    storyViewer.openStory(authorStories[0].id, authorStories);
                }
            });

            container.appendChild(card);
        });

    } catch (err) {
        console.warn('Stories load error:', err);
    }
}

/** Infinite scroll — load next page when user reaches bottom of feed */
function _initInfiniteScroll() {
    const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !_feedLoading && !_feedExhausted) {
            loadRealFeed(_feedPage);
        }
    }, { rootMargin: '300px' });

    // Sentinel element at the bottom of the feed
    const sentinel = document.createElement('div');
    sentinel.id = 'feedSentinel';
    sentinel.style.height = '1px';
    const feedPosts = document.getElementById('feedPosts');
    if (feedPosts) feedPosts.after(sentinel);
    observer.observe(sentinel);
}
document.addEventListener('DOMContentLoaded', () => {
    // Load real posts and stories from API
    loadRealFeed(1);
    loadRealStories();

    // Sidebar
    setTimeout(updateSocialSidebar, 400);

    // Create-post modal: close on backdrop click
    window.addEventListener('click', e => {
        const modal = document.getElementById('createPostModal');
        if (e.target === modal) closeCreatePostModal();
    });

    // Stories scroll behaviour
    _initStoriesScroll();

    // Live feed ticker (sidebar)
    setTimeout(_startLiveFeedTicker, 5000);

    // Infinite scroll for more posts
    _initInfiniteScroll();
});
