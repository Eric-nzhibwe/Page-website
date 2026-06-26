/**
 * ARTX Real-time Updates & Social Graph
 * ─────────────────────────────────────
 * • Smart polling (feed, notifications, online users)
 * • Full follow / unfollow with optimistic UI
 * • User discovery + live search
 * • Deduplication — no notification or post rendered twice
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const _RT_BASE = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api'
  : `${window.location.origin}/api`;

function _rtHeaders() {
    const token = localStorage.getItem('djangoAuthToken');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Token ${token}`;
    return h;
}

// ─────────────────────────────────────────────────────────────────────────────
//  TOAST  (safe re-use — checks if auth.js version exists)
// ─────────────────────────────────────────────────────────────────────────────
function _rtToast(msg, type = 'info') {
    if (typeof socialToast === 'function') { socialToast(msg, type); return; }
    if (typeof showToast   === 'function') { showToast(msg, type);   return; }
    console.info(`[ARTX] ${type.toUpperCase()}: ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  ESCAPE HTML  (shared helper)
// ─────────────────────────────────────────────────────────────────────────────
function _rtEsc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function _rtTimeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)  return 'just now';
    const m = Math.floor(s / 60);   if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);   if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);   if (d < 7)   return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

// ─────────────────────────────────────────────────────────────────────────────
//  FOLLOW / UNFOLLOW  (the core of what was broken)
// ─────────────────────────────────────────────────────────────────────────────

/** In-memory set of user-ids the current user is following. */
const _followingSet = new Set();

/**
 * Toggle follow state for a user.
 * Called from any follow button: onclick="toggleFollow(userId, this)"
 */
async function toggleFollow(userId, btnEl) {
    if (!userId) return;

    const isFollowing = _followingSet.has(String(userId));
    const endpoint    = isFollowing
        ? `${_RT_BASE}/social/follows/unfollow/`
        : `${_RT_BASE}/social/follows/follow/`;

    // Optimistic UI
    _applyFollowState(userId, !isFollowing, btnEl);

    try {
        const res = await fetch(endpoint, {
            method:  'POST',
            headers: _rtHeaders(),
            body:    JSON.stringify({ user_id: userId })
        });

        if (!res.ok) {
            // Rollback
            _applyFollowState(userId, isFollowing, btnEl);
            const err = await res.json().catch(() => ({}));
            _rtToast(err.error || 'Could not update follow status.', 'error');
            return;
        }

        if (!isFollowing) {
            _followingSet.add(String(userId));
            _rtToast('Following! 🎉', 'success');
        } else {
            _followingSet.delete(String(userId));
            _rtToast('Unfollowed.', 'info');
        }

        // Update ALL buttons for this user across the page
        _updateAllFollowButtons(userId);

        // Refresh follower count displayed anywhere on the page
        _refreshFollowCounts(userId);

    } catch {
        _applyFollowState(userId, isFollowing, btnEl);
        _rtToast('Network error. Please try again.', 'error');
    }
}

/** Kept for backward compat — old code calls followUser(id) */
async function followUser(userId) {
    if (_followingSet.has(String(userId))) return; // already following
    const btn = document.querySelector(`[data-user-id="${userId}"] .artx-follow-btn`);
    await toggleFollow(userId, btn);
}

async function unfollowUser(userId) {
    if (!_followingSet.has(String(userId))) return; // not following
    const btn = document.querySelector(`[data-user-id="${userId}"] .artx-follow-btn`);
    await toggleFollow(userId, btn);
}

function _applyFollowState(userId, following, btnEl) {
    if (following) {
        _followingSet.add(String(userId));
    } else {
        _followingSet.delete(String(userId));
    }
    if (btnEl) _styleFollowBtn(btnEl, following);
}

function _styleFollowBtn(btn, following) {
    btn.dataset.following = following ? '1' : '0';
    if (following) {
        btn.innerHTML     = '<i class="fas fa-check"></i> Following';
        btn.classList.add('artx-follow-btn--following');
    } else {
        btn.innerHTML     = '<i class="fas fa-user-plus"></i> Follow';
        btn.classList.remove('artx-follow-btn--following');
    }
}

function _updateAllFollowButtons(userId) {
    const following = _followingSet.has(String(userId));
    document.querySelectorAll(`.artx-follow-btn[data-uid="${userId}"]`)
        .forEach(btn => _styleFollowBtn(btn, following));
}

/** Fetch and update follower/following counts after a follow action */
async function _refreshFollowCounts(userId) {
    try {
        const res = await fetch(`${_RT_BASE}/social/follows/counts/?user_id=${userId}`, {
            headers: _rtHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        // Update any elements on the page that show counts for this user
        const fcEl = document.getElementById('statFollowers');
        const fgEl = document.getElementById('statFollowing');
        if (fcEl) fcEl.textContent = data.followers_count ?? fcEl.textContent;
        if (fgEl) fgEl.textContent = data.following_count ?? fgEl.textContent;
    } catch { /* silent */ }
}

/** Build a follow button element */
function _makeFollowBtn(userId, isFollowing) {
    const btn = document.createElement('button');
    btn.className     = `artx-follow-btn${isFollowing ? ' artx-follow-btn--following' : ''}`;
    btn.dataset.uid   = userId;
    btn.setAttribute('aria-label', isFollowing ? 'Unfollow' : 'Follow');
    btn.innerHTML     = isFollowing
        ? '<i class="fas fa-check"></i> Following'
        : '<i class="fas fa-user-plus"></i> Follow';
    btn.addEventListener('click', () => toggleFollow(userId, btn));
    return btn;
}

/** Load current user's following list to seed _followingSet */
async function _loadFollowingSet() {
    try {
        const res = await fetch(`${_RT_BASE}/social/follows/following/`, {
            headers: _rtHeaders()
        });
        if (!res.ok) return;
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.results || []);
        list.forEach(f => {
            const id = f.user?.id ?? f.following?.id ?? f.id;
            if (id) _followingSet.add(String(id));
        });
    } catch { /* silent — offline is fine */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  USER DISCOVERY  (Discover Users + Suggested sidebar)
// ─────────────────────────────────────────────────────────────────────────────

async function loadDiscoverUsers() {
    const container = document.getElementById('discoverUsersList');
    const mobileContainer = document.getElementById('discoverUsersListMobile');
    if (!container && !mobileContainer) return;

    if (container) _showUserSkeleton(container, 4);
    if (mobileContainer) _showUserSkeleton(mobileContainer, 4);

    try {
        const res = await fetch(`${_RT_BASE}/auth/discover/`, { headers: _rtHeaders() });
        if (!res.ok) throw new Error('API error');
        const users = await res.json();
        if (container) _renderDiscoverList(container, users, 'discover');
        if (mobileContainer) _renderDiscoverList(mobileContainer, users, 'discover');
    } catch {
        const err = '<p class="artx-no-users">Could not load users.</p>';
        if (container) container.innerHTML = err;
        if (mobileContainer) mobileContainer.innerHTML = err;
    }
}

async function loadSuggestedUsers() {
    const container = document.getElementById('suggestedUsersList');
    const mobileContainer = document.getElementById('suggestedUsersListMobile');
    if (!container && !mobileContainer) return;

    if (container) _showUserSkeleton(container, 3);
    if (mobileContainer) _showUserSkeleton(mobileContainer, 3);

    try {
        const res = await fetch(`${_RT_BASE}/auth/discover/?limit=6`, { headers: _rtHeaders() });
        if (!res.ok) throw new Error('API error');
        const users = await res.json();
        if (container) _renderDiscoverList(container, users.slice(0, 6), 'suggested');
        if (mobileContainer) _renderDiscoverList(mobileContainer, users.slice(0, 6), 'suggested');
    } catch {
        const err = '<p class="artx-no-users">Could not load suggestions.</p>';
        if (container) container.innerHTML = err;
        if (mobileContainer) mobileContainer.innerHTML = err;
    }
}

async function searchUsers(query) {
    const container = document.getElementById('discoverUsersList');
    const mobileContainer = document.getElementById('discoverUsersListMobile');

    if (!container && !mobileContainer) return;

    if (!query || query.trim().length < 1) {
        loadDiscoverUsers();
        return;
    }

    if (container) _showUserSkeleton(container, 3);
    if (mobileContainer) _showUserSkeleton(mobileContainer, 3);

    try {
        const res = await fetch(`${_RT_BASE}/auth/search/?q=${encodeURIComponent(query)}`, {
            headers: _rtHeaders()
        });
        if (!res.ok) throw new Error('API error');
        const users = await res.json();
        const noResult = `<p class="artx-no-users">No users found for "<strong>${_rtEsc(query)}</strong>"</p>`;
        if (users.length === 0) {
            if (container) container.innerHTML = noResult;
            if (mobileContainer) mobileContainer.innerHTML = noResult;
        } else {
            if (container) _renderDiscoverList(container, users, 'search');
            if (mobileContainer) _renderDiscoverList(mobileContainer, users, 'search');
        }
    } catch {
        const err = '<p class="artx-no-users">Search failed. Please try again.</p>';
        if (container) container.innerHTML = err;
        if (mobileContainer) mobileContainer.innerHTML = err;
    }
}

function _renderDiscoverList(container, users, mode) {
    if (!users || users.length === 0) {
        container.innerHTML = '<p class="artx-no-users">No users to show right now.</p>';
        return;
    }

    container.innerHTML = '';
    users.forEach(u => {
        const isFollowing = _followingSet.has(String(u.id));
        const item = document.createElement('div');
        item.className       = 'artx-user-item';
        item.dataset.userId  = u.id;

        const avatarHTML = u.profile_image
            ? `<img src="${_rtEsc(u.profile_image)}" alt="${_rtEsc(u.display_name)}" class="artx-user-avatar-img">`
            : `<i class="fas fa-user-circle"></i>`;

        item.innerHTML = `
          <div class="artx-user-avatar">${avatarHTML}</div>
          <div class="artx-user-info">
            <strong class="artx-user-name">${_rtEsc(u.display_name || u.username)}</strong>
            <span class="artx-user-tier artx-tier--${(u.access_tier||'bronze').toLowerCase()}">
              ${_rtEsc(u.access_tier || 'Bronze')}
            </span>
          </div>`;

        const btn = _makeFollowBtn(u.id, isFollowing);
        item.appendChild(btn);
        container.appendChild(item);
    });
}

function _showUserSkeleton(container, count) {
    container.innerHTML = Array.from({ length: count }, () => `
      <div class="artx-user-skel">
        <div class="artx-skel-circle"></div>
        <div class="artx-skel-lines">
          <div class="artx-skel-line artx-skel-line--70"></div>
          <div class="artx-skel-line artx-skel-line--40"></div>
        </div>
      </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
//  ONLINE USERS  (right sidebar)
// ─────────────────────────────────────────────────────────────────────────────
const _onlineMap  = new Map();
let   _onlinePollTimer = null;

function _startOnlinePoller() {
    _pollOnlineUsers();
    _onlinePollTimer = setInterval(_pollOnlineUsers, 45_000); // every 45 s
}

async function _pollOnlineUsers() {
    // The backend has no dedicated "online" endpoint yet — approximate with
    // recent active users from the discover list.
    try {
        const res = await fetch(`${_RT_BASE}/auth/discover/?limit=8`, { headers: _rtHeaders() });
        if (!res.ok) return;
        const users = await res.json();
        _renderOnlineUsers(users.slice(0, 8));
    } catch { /* silent */ }
}

function _renderOnlineUsers(users) {
    const container = document.getElementById('onlineUsers');
    const mobileContainer = document.getElementById('onlineUsersMobile');

    const noUsers = '<p class="artx-no-users">No users online right now.</p>';
    const noUsersMobile = '<p class="people-loading">No users online right now.</p>';

    if (!users || users.length === 0) {
        if (container) container.innerHTML = noUsers;
        if (mobileContainer) mobileContainer.innerHTML = noUsersMobile;
        return;
    }

    // Desktop sidebar render
    if (container) {
        container.innerHTML = '';
        users.forEach(u => {
            const isFollowing = _followingSet.has(String(u.id));
            const item = document.createElement('div');
            item.className = 'artx-online-item';
            item.dataset.userId = u.id;
            const avatarHTML = u.profile_image
                ? `<img src="${_rtEsc(u.profile_image)}" alt="${_rtEsc(u.display_name)}" class="artx-user-avatar-img">`
                : `<i class="fas fa-user-circle"></i>`;
            item.innerHTML = `
              <div class="artx-online-avatar">
                ${avatarHTML}
                <span class="artx-online-dot" title="Online"></span>
              </div>
              <div class="artx-user-info">
                <strong class="artx-user-name">${_rtEsc(u.display_name || u.username)}</strong>
                <span class="artx-online-label">Active</span>
              </div>`;
            const btn = _makeFollowBtn(u.id, isFollowing);
            btn.classList.add('artx-follow-btn--sm');
            item.appendChild(btn);
            container.appendChild(item);
        });
    }

    // Mobile people view — horizontal avatar chips
    if (mobileContainer) {
        mobileContainer.innerHTML = '';
        users.forEach(u => {
            const chip = document.createElement('div');
            chip.className = 'online-user-chip';
            chip.title = u.display_name || u.username;
            const avatarInner = u.profile_image
                ? `<img src="${_rtEsc(u.profile_image)}" alt="${_rtEsc(u.display_name)}">`
                : `<i class="fas fa-user-circle"></i>`;
            chip.innerHTML = `
              <div class="chip-avatar">
                ${avatarInner}
                <span class="chip-badge"></span>
              </div>
              <span class="chip-name">${_rtEsc((u.display_name || u.username).split(' ')[0])}</span>`;
            chip.onclick = () => window.location.href = `pages/user.html?id=${u.id}`;
            mobileContainer.appendChild(chip);
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  FEED POLLING  (smart — only updates counts, doesn't wipe DOM)
// ─────────────────────────────────────────────────────────────────────────────
let _feedPollTimer     = null;
let _seenPostIds       = new Set();     // dedup — never re-insert a post
let _lastFeedPoll      = 0;
const FEED_POLL_MS     = 30_000;        // 30 seconds — kind to the server

function _startFeedPoller() {
    _pollFeed();
    _feedPollTimer = setInterval(_pollFeed, FEED_POLL_MS);
}

async function _pollFeed() {
    const now = Date.now();
    if (now - _lastFeedPoll < FEED_POLL_MS - 1000) return; // guard double-fire
    _lastFeedPoll = now;

    try {
        const res = await fetch(`${_RT_BASE}/social/posts/`, { headers: _rtHeaders() });
        if (!res.ok) return;
        const data  = await res.json();
        const posts = Array.isArray(data) ? data : (data.results || []);

        const container = document.getElementById('feedPosts');
        if (!container) return;

        // If feed is still showing only static sample posts, replace them
        const hasSampleOnly = !container.querySelector('[data-post-id^="post-"]')
            || !container.querySelector('[data-post-id]:not([data-post-id^="post-"])');

        if (hasSampleOnly && posts.length > 0 && _seenPostIds.size === 0) {
            // First real load — replace static sample posts
            const sampleCards = container.querySelectorAll('[data-post-id^="post-"]');
            sampleCards.forEach(c => c.remove());
        }

        // Prepend only NEW posts (newest first from API)
        const newPosts = posts.filter(p => !_seenPostIds.has(String(p.id)));

        newPosts.forEach(p => {
            _seenPostIds.add(String(p.id));
            const el = _buildPostCard(p);
            el.classList.add('post-card--new');
            container.insertBefore(el, container.firstChild);
        });

        // For existing posts — silently update their counts only
        posts.forEach(p => {
            _patchPostCounts(p.id, p.reaction_count, p.comment_count, p.share_count);
        });

    } catch { /* silent — offline is fine */ }
}

function _patchPostCounts(postId, reactions, comments, shares) {
    const card = document.querySelector(`[data-post-id="${postId}"]`);
    if (!card) return;
    const rEl = card.querySelector('.post-stats span:first-child');
    if (rEl && reactions != null) rEl.innerHTML = `<i class="fas fa-fire"></i> ${reactions} reactions`;
    const cEl = card.querySelector('.comment-count');
    if (cEl && comments != null) cEl.textContent = comments;
    const sEl = card.querySelector('.share-count');
    if (sEl && shares   != null) sEl.textContent = shares;
}

/** Build a full post card DOM element from API data */
function _buildPostCard(post) {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.setAttribute('data-post-id', post.id);

    const author   = post.author || {};
    const name     = _rtEsc(author.display_name || author.username || 'User');
    const when     = _rtTimeAgo(post.created_at);
    const content  = _rtEsc(post.content || '');

    const avatarHTML = author.profile_image
        ? `<img src="${_rtEsc(author.profile_image)}" alt="${name}" class="artx-user-avatar-img">`
        : `<i class="fas fa-user-circle"></i>`;

    let mediaHTML = '';
    if (post.media_url) {
        mediaHTML = post.media_type === 'video'
            ? `<div class="post-media"><video controls><source src="${_rtEsc(post.media_url)}"></video></div>`
            : `<div class="post-media"><img src="${_rtEsc(post.media_url)}" alt="Post media" loading="lazy"></div>`;
    }
    if (post.achievement_badge && post.achievement_badge.title) {
        const ab = post.achievement_badge;
        mediaHTML = `<div class="post-media">
          <div class="achievement-badge-large">
            <i class="fas fa-trophy"></i>
            <h3>${_rtEsc(ab.title)}</h3>
            <p>${_rtEsc(ab.description || '')}</p>
          </div></div>`;
    }

    div.innerHTML = `
      <div class="post-header">
        <div class="post-author">
          <div class="post-avatar">${avatarHTML}</div>
          <div class="post-author-info">
            <h4>${name}</h4>
            <span class="post-time">${when}</span>
          </div>
        </div>
        <button class="post-menu-btn" onclick="showPostMenu('${post.id}')">
          <i class="fas fa-ellipsis-h"></i>
        </button>
      </div>
      <div class="post-content"><p>${content}</p></div>
      ${mediaHTML}
      <div class="post-stats">
        <span><i class="fas fa-fire"></i> ${post.reaction_count ?? 0} reactions</span>
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

    return div;
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTIFICATION WebSocket  (real-time bell badge + toasts)
// ─────────────────────────────────────────────────────────────────────────────
let _notifWs        = null;
let _notifWsRetries = 0;
const _seenNotifIds = new Set();
let   _notifTimer   = null;          // fallback poll timer

function _wsBase() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'localhost:8000'
        : window.location.host;
    return `${proto}://${host}`;
}

function _connectNotifWs() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return;

    if (_notifWs && (_notifWs.readyState === WebSocket.OPEN || _notifWs.readyState === WebSocket.CONNECTING)) return;

    _notifWs = new WebSocket(`${_wsBase()}/ws/notifications/?token=${token}`);

    _notifWs.onopen = () => {
        _notifWsRetries = 0;
        // Cancel fallback poll — WS is live
        if (_notifTimer) { clearInterval(_notifTimer); _notifTimer = null; }
    };

    _notifWs.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            _handleNotifMessage(msg);
        } catch { /* ignore malformed */ }
    };

    _notifWs.onclose = () => {
        _notifWs = null;
        // Exponential back-off reconnect (max 30 s)
        const delay = Math.min(1000 * 2 ** _notifWsRetries, 30_000);
        _notifWsRetries++;
        setTimeout(_connectNotifWs, delay);
        // Start fallback polling while disconnected
        if (!_notifTimer) _startNotifPoller();
    };

    _notifWs.onerror = () => { _notifWs?.close(); };

    // Keep-alive ping every 25 s
    setInterval(() => {
        if (_notifWs?.readyState === WebSocket.OPEN) {
            _notifWs.send(JSON.stringify({ action: 'ping' }));
        }
    }, 25_000);
}

function _handleNotifMessage(msg) {
    switch (msg.type) {

        case 'notifications_snapshot': {
            // Initial snapshot on connect — seed seen-ids and set badge
            const list = msg.notifications || [];
            list.forEach(n => _seenNotifIds.add(n.id));
            _updateBellBadge(msg.unread_count ?? 0);
            break;
        }

        case 'new_notification': {
            const n = msg.notification;
            if (!n || _seenNotifIds.has(n.id)) break;
            _seenNotifIds.add(n.id);

            // Toast
            const toastMsg = n.type === 'follow'
                ? `${n.actor?.display_name || 'Someone'} started following you 👤`
                : n.type === 'comment'
                    ? `${n.actor?.display_name || 'Someone'} commented on your post 💬`
                    : n.type === 'reaction'
                        ? `${n.actor?.display_name || 'Someone'} reacted to your post 🔥`
                        : (n.title || 'New notification');
            _rtToast(toastMsg, 'info');

            // Increment badge
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const current = parseInt(badge.textContent, 10) || 0;
                _updateBellBadge(current + 1);
            }

            // Prepend to open notification dropdown if it's visible
            _prependNotifToDropdown(n);
            break;
        }

        case 'marked_read': {
            _updateBellBadge(0);
            break;
        }
    }
}

function _updateBellBadge(count) {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    badge.textContent    = count > 99 ? '99+' : count;
    badge.style.display  = count > 0 ? 'inline-block' : 'none';
}

function _prependNotifToDropdown(n) {
    // Only insert if the dropdown panel is currently open/visible
    const panel = document.getElementById('notificationsPanel') ||
                  document.querySelector('.notifications-dropdown');
    if (!panel || panel.style.display === 'none' || panel.hidden) return;

    const list = panel.querySelector('.notifications-list, .notif-list, ul');
    if (!list) return;

    const actor = n.actor?.display_name || n.actor?.username || 'Someone';
    const item  = document.createElement('li');
    item.className = 'notif-item notif-item--new';
    item.innerHTML = `
        <a href="${_rtEsc(n.link || '#')}" class="notif-link">
            <strong>${_rtEsc(actor)}</strong> ${_rtEsc(n.title)}
            <span class="notif-time">just now</span>
        </a>`;
    list.insertBefore(item, list.firstChild);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NOTIFICATION POLLING  (fallback when WS is disconnected)
// ─────────────────────────────────────────────────────────────────────────────

function _startNotifPoller() {
    _pollNotifications();
    _notifTimer = setInterval(_pollNotifications, 20_000); // 20 s
}

async function _pollNotifications() {
    // Skip if WS is live — no need to poll
    if (_notifWs?.readyState === WebSocket.OPEN) return;

    try {
        const res = await fetch(`${_RT_BASE}/notifications/`, { headers: _rtHeaders() });
        if (!res.ok) return;
        const data  = await res.json();
        const list  = data.notifications || (Array.isArray(data) ? data : (data.results || []));
        let   badge = data.unread_count ?? 0;
        const newIds = [];

        list.forEach(n => {
            if (_seenNotifIds.has(n.id)) return;
            _seenNotifIds.add(n.id);
            newIds.push(n.id);
            if (!n.is_read) {
                const msg = n.type === 'follow'
                    ? `${n.actor?.display_name || 'Someone'} started following you 👤`
                    : (n.message || n.title || 'New notification');
                _rtToast(msg, 'info');
            }
        });

        if (newIds.length > 0) {
            fetch(`${_RT_BASE}/notifications/read/`, {
                method: 'POST',
                headers: _rtHeaders(),
                body: JSON.stringify({ ids: newIds }),
            }).catch(() => {});
        }

        _updateBellBadge(badge);
    } catch { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────────────
function _initRealtimeUpdates() {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) return; // Not logged in — nothing to do

    // ── 1. WebSocket feed connection ──────────────────────────────────────────
    wsClient.connectFeed();

    // When we get the feed snapshot, replace static sample posts
    wsClient.on('feed', 'snapshot', ({ posts }) => {
        if (!posts?.length) return;
        const container = document.getElementById('feedPosts');
        if (!container) return;
        // Remove static sample cards (data-post-id="post-1" etc.)
        container.querySelectorAll('[data-post-id^="post-"]').forEach(c => c.remove());
        // Mark them all as seen then insert
        posts.forEach(p => {
            if (!_seenPostIds.has(String(p.id))) {
                _seenPostIds.add(String(p.id));
                container.appendChild(_buildPostCard(p));
            }
        });
    });

    // New post broadcast from another user
    wsClient.on('feed', 'new_post', ({ post }) => {
        if (_seenPostIds.has(String(post.id))) return;
        _seenPostIds.add(String(post.id));
        const container = document.getElementById('feedPosts');
        if (!container) return;
        const el = _buildPostCard(post);
        el.classList.add('post-card--new');
        container.insertBefore(el, container.firstChild);
    });

    // Count patches (reactions / comments / shares from other users)
    wsClient.on('feed', 'post_update', data => {
        _patchPostCounts(data.post_id, data.reaction_count, data.comment_count, data.share_count);
    });

    // Live activity ticker (sidebar)
    wsClient.on('feed', 'live_activity', ({ user, action }) => {
        const feed = document.querySelector('.live-feed');
        if (!feed) return;
        const item = document.createElement('div');
        item.className = 'live-item';
        item.style.animation = 'fadeInCard .4s ease';
        item.innerHTML = `
            <span class="live-dot"></span>
            <div class="live-info">
                <strong>${_rtEsc(user)}</strong> ${_rtEsc(action)}
                <span class="live-time">Just now</span>
            </div>`;
        feed.insertBefore(item, feed.firstChild);
        while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    });

    // New story from someone we follow
    wsClient.on('feed', 'new_story', ({ story }) => {
        _appendStoryCard(story);
    });

    // ── 2. Stories WS connection ──────────────────────────────────────────────
    wsClient.connectToStories({
        onSnapshot: stories => {
            if (!stories?.length) return;
            const container = document.querySelector('.stories-container');
            if (!container) return;
            // Keep create-story card, add real stories after it
            const createCard = container.querySelector('.create-story');
            stories.forEach(s => {
                if (!container.querySelector(`[data-story-id="${s.id}"]`)) {
                    const card = _buildStoryCard(s);
                    if (createCard?.nextSibling) container.insertBefore(card, createCard.nextSibling);
                    else container.appendChild(card);
                }
            });
        }
    });

    // ── 3. Load who we're following first so follow buttons render correctly ──
    _loadFollowingSet().then(() => {
        loadDiscoverUsers();
        loadSuggestedUsers();
        _renderOnlineUsers([]);
        _startOnlinePoller();
    });

    // ── 4. Notification WebSocket (real-time bell badge + toasts) ────────────
    _connectNotifWs();
    // Fallback poller starts automatically if WS fails to connect

    // ── 5. Pause everything when tab is hidden ────────────────────────────────
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(_notifTimer);
            clearInterval(_onlinePollTimer);
            _notifTimer = _onlinePollTimer = null;
        } else {
            _connectNotifWs();   // reconnect WS if it dropped while hidden
            _startOnlinePoller();
        }
    });
}

// ── Story card builder (for WS-pushed stories) ────────────────────────────────
function _buildStoryCard(story) {
    const card = document.createElement('div');
    card.className = 'story-card';
    card.dataset.storyId = story.id;

    const author = story.author || {};
    const name   = author.display_name || author.username || 'User';
    const bgGrad = ['linear-gradient(135deg,#667eea,#764ba2)',
                     'linear-gradient(135deg,#f093fb,#f5576c)',
                     'linear-gradient(135deg,#4facfe,#00f2fe)',
                     'linear-gradient(135deg,#43e97b,#38f9d7)',
                     'linear-gradient(135deg,#fa709a,#fee140)'];
    const grad = bgGrad[Math.floor(Math.random() * bgGrad.length)];

    card.innerHTML = `
        <div class="story-image" style="background:${grad}">
            ${story.media_url
                ? (story.media_type === 'video'
                    ? `<video src="${_rtEsc(story.media_url)}" style="width:100%;height:100%;object-fit:cover"></video>`
                    : `<img src="${_rtEsc(story.media_url)}" style="width:100%;height:100%;object-fit:cover" alt="">`)
                : `<i class="fas fa-user"></i>`}
        </div>
        <span class="story-name">${_rtEsc(name)}</span>`;

    card.onclick = () => {
        if (window.storyViewer) {
            storyViewer.openStory(story.id, [story]);
        }
    };
    return card;
}

function _appendStoryCard(story) {
    const container  = document.querySelector('.stories-container');
    const createCard = container?.querySelector('.create-story');
    if (!container) return;
    const card = _buildStoryCard(story);
    if (createCard?.nextSibling) container.insertBefore(card, createCard.nextSibling);
    else container.appendChild(card);
}

document.addEventListener('DOMContentLoaded', _initRealtimeUpdates);

window.addEventListener('beforeunload', () => {
    clearInterval(_feedPollTimer);
    clearInterval(_notifTimer);
    clearInterval(_onlinePollTimer);
});

// ─────────────────────────────────────────────────────────────────────────────
//  GLOBAL EXPORTS  (called from inline HTML and other scripts)
// ─────────────────────────────────────────────────────────────────────────────
window.toggleFollow    = toggleFollow;
window.followUser      = followUser;
window.unfollowUser    = unfollowUser;
window.searchUsers     = searchUsers;         // wires up the sidebar search input
window.loadDiscoverUsers  = loadDiscoverUsers;
window.loadSuggestedUsers = loadSuggestedUsers;
