// ARTX — Community Page  ·  community.js
// All data comes from the Django REST API

const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000/api'
    : `${window.location.origin}/api`;

let currentUser   = null;
let feedPage      = 1;
let feedHasMore   = false;
let activePostId  = null;
let newPostType   = 'text';

// ── Auth header helper ────────────────────────────────────────
function authHeader() {
    return { 'Authorization': `Token ${localStorage.getItem('djangoAuthToken')}` };
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('djangoAuthToken');
    if (!token) { window.location.href = 'auth.html'; return; }

    // Load current user for context (prestige balance etc.)
    try {
        const r = await fetch(`${API}/auth/stats/`, { headers: authHeader() });
        if (r.ok) {
            const d = await r.json();
            currentUser = d.user;
            populateUserMenu(currentUser);
            setText('shopBalance', currentUser.prestige_points.toLocaleString());
        } else {
            window.location.href = 'auth.html';
            return;
        }
    } catch (e) {
        console.error('Auth check failed', e);
        window.location.href = 'auth.html';
        return;
    }

    loadFeed();
    loadTopMembers('prestige');
});

function populateUserMenu(u) {
    setText('menuUsername', u.display_name || u.username);
    setText('menuTier',     `${u.access_tier} Tier`);
    setText('menuStreak',   u.current_streak);
    setText('menuPrestige', u.prestige_points.toLocaleString());
    setText('menuBalance',  `K${parseFloat(u.total_earnings).toFixed(0)}`);
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(tabName, btn) {
    document.querySelectorAll('.comm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.comm-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ══════════════════════════════════════════════════════════════
//  FEED
// ══════════════════════════════════════════════════════════════
async function loadFeed(reset = true) {
    if (reset) { feedPage = 1; feedHasMore = false; }

    const sort  = document.getElementById('sortFilter').value;
    const order = sort === 'popular' ? '-reaction_count' : '-created_at';

    try {
        const r = await fetch(
            `${API}/social/posts/?ordering=${order}&page=${feedPage}&page_size=12`,
            { headers: authHeader() }
        );
        if (!r.ok) throw new Error('Feed load failed');
        const data = await r.json();

        const posts = data.results || data;
        feedHasMore = !!(data.next);

        const grid = document.getElementById('feedGrid');
        if (reset) {
            grid.innerHTML = '';
        }

        if (!posts.length && reset) {
            grid.innerHTML = emptyState('fa-newspaper', 'No posts yet — be the first!');
            document.getElementById('feedPagination').style.display = 'none';
            return;
        }

        posts.forEach((p, i) => {
            const card = document.createElement('div');
            card.className = 'feed-card';
            card.style.animationDelay = `${i * 0.04}s`;
            card.innerHTML = buildPostCard(p);
            grid.appendChild(card);
        });

        document.getElementById('feedPagination').style.display = feedHasMore ? 'flex' : 'none';
    } catch (e) {
        console.error(e);
        document.getElementById('feedGrid').innerHTML = emptyState('fa-triangle-exclamation', 'Could not load feed');
    }
}

async function loadMoreFeed() {
    feedPage++;
    await loadFeed(false);
}

function buildPostCard(p) {
    const initials  = (p.author_name || p.author?.username || '?')[0].toUpperCase();
    const avatar    = p.author_avatar
        ? `<img src="${p.author_avatar}" alt="avatar">`
        : `<span class="av-initial">${initials}</span>`;
    const ago       = timeAgo(p.created_at);
    const reacted   = p.user_reaction; // set by serializer
    const typeLabel = { text: '', achievement: '🏆 Achievement', challenge: '⚡ Challenge', media: '🖼 Media' }[p.post_type] || '';
    const mediaHtml = p.media_url
        ? `<div class="card-media"><img src="${p.media_url}" alt="post media" onerror="this.style.display='none'"></div>`
        : '';

    return `
        <div class="card-header">
            <div class="card-av">${avatar}</div>
            <div class="card-meta">
                <span class="card-name">${escHtml(p.author_name || p.author?.username || 'Member')}</span>
                <span class="card-time">${ago}${typeLabel ? ' · <em>' + typeLabel + '</em>' : ''}</span>
            </div>
        </div>
        <div class="card-body" onclick="openPostModal('${p.id}')" style="cursor:pointer">
            <p class="card-content">${escHtml(p.content)}</p>
            ${mediaHtml}
        </div>
        <div class="card-footer">
            <div class="card-reactions">
                <button class="react-btn ${reacted ? 'reacted' : ''}" onclick="toggleReact('${p.id}', this)">
                    <i class="fas fa-fire"></i>
                    <span class="react-count">${p.reaction_count || 0}</span>
                </button>
                <button class="comment-btn" onclick="openPostModal('${p.id}')">
                    <i class="fas fa-comment"></i>
                    <span>${p.comment_count || 0}</span>
                </button>
            </div>
            <button class="share-card-btn" onclick="sharePost('${p.id}')">
                <i class="fas fa-share-nodes"></i>
            </button>
        </div>`;
}

// ── React to post ─────────────────────────────────────────────
async function toggleReact(postId, btn) {
    const reacted = btn.classList.contains('reacted');
    const countEl = btn.querySelector('.react-count');

    // Optimistic UI
    btn.classList.toggle('reacted');
    const delta = reacted ? -1 : 1;
    countEl.textContent = Math.max(0, parseInt(countEl.textContent) + delta);

    try {
        const url    = `${API}/social/posts/${postId}/${reacted ? 'unreact' : 'react'}/`;
        const method = 'POST';
        const opts   = {
            method,
            headers: { ...authHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ reaction_type: 'fire' })
        };
        const r = await fetch(url, opts);
        if (!r.ok) throw new Error('React failed');
    } catch (e) {
        // Revert on error
        btn.classList.toggle('reacted');
        countEl.textContent = Math.max(0, parseInt(countEl.textContent) - delta);
        showToast('Could not update reaction');
    }
}

// ── Open post detail modal ────────────────────────────────────
async function openPostModal(postId) {
    activePostId = postId;
    document.getElementById('postModalContent').innerHTML = '<div class="modal-loading"><i class="fas fa-spinner fa-spin"></i></div>';
    document.getElementById('commentsList').innerHTML = '';
    document.getElementById('postModal').classList.add('open');

    try {
        const [pr, cr] = await Promise.all([
            fetch(`${API}/social/posts/${postId}/`, { headers: authHeader() }),
            fetch(`${API}/social/comments/?post_id=${postId}`, { headers: authHeader() })
        ]);
        const post     = await pr.json();
        const comments = await cr.json();

        const initials = (post.author_name || '?')[0].toUpperCase();
        const avatar   = post.author_avatar
            ? `<img src="${post.author_avatar}" alt="avatar">`
            : `<span class="av-initial">${initials}</span>`;
        const mediaHtml = post.media_url
            ? `<div class="modal-media"><img src="${post.media_url}" alt="media"></div>`
            : '';
        const reacted  = post.user_reaction;

        document.getElementById('postModalContent').innerHTML = `
            <div class="modal-post-header">
                <div class="card-av">${avatar}</div>
                <div class="card-meta">
                    <span class="card-name">${escHtml(post.author_name || post.author?.username || 'Member')}</span>
                    <span class="card-time">${timeAgo(post.created_at)}</span>
                </div>
            </div>
            <p class="modal-post-body">${escHtml(post.content)}</p>
            ${mediaHtml}
            <div class="modal-reactions">
                <button class="react-btn ${reacted ? 'reacted' : ''}" onclick="toggleReact('${post.id}', this)">
                    <i class="fas fa-fire"></i> <span class="react-count">${post.reaction_count || 0}</span>
                </button>
                <span class="modal-comment-count"><i class="fas fa-comment"></i> ${post.comment_count || 0}</span>
            </div>`;

        const cList  = Array.isArray(comments) ? comments : (comments.results || []);
        const listEl = document.getElementById('commentsList');
        if (!cList.length) {
            listEl.innerHTML = '<p class="no-comments">No comments yet. Be the first!</p>';
        } else {
            listEl.innerHTML = cList.map(c => `
                <div class="comment-item">
                    <div class="comment-av">
                        ${c.author_avatar
                            ? `<img src="${c.author_avatar}" alt="av">`
                            : `<span class="av-initial">${(c.author_name || '?')[0].toUpperCase()}</span>`}
                    </div>
                    <div class="comment-body">
                        <span class="comment-author">${escHtml(c.author_name || 'Member')}</span>
                        <span class="comment-text">${escHtml(c.content)}</span>
                        <span class="comment-time">${timeAgo(c.created_at)}</span>
                    </div>
                </div>`).join('');
        }
    } catch (e) {
        document.getElementById('postModalContent').innerHTML = emptyState('fa-triangle-exclamation', 'Could not load post');
    }
}

function closePostModal() {
    document.getElementById('postModal').classList.remove('open');
    activePostId = null;
}

// ── Submit comment ────────────────────────────────────────────
async function submitComment() {
    if (!activePostId) return;
    const input   = document.getElementById('commentInput');
    const content = input.value.trim();
    if (!content) return;

    try {
        const r = await fetch(`${API}/social/comments/`, {
            method: 'POST',
            headers: { ...authHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, post_id: activePostId })
        });
        if (!r.ok) throw new Error('Comment failed');
        input.value = '';
        openPostModal(activePostId); // Refresh
        showToast('Comment posted ✓');
    } catch (e) {
        showToast('Could not post comment');
    }
}

// ── Share post ────────────────────────────────────────────────
async function sharePost(postId) {
    const url = `${window.location.origin}/posts/${postId}`;
    if (navigator.share) {
        navigator.share({ title: 'ARTX Post', url });
    } else {
        navigator.clipboard.writeText(url).then(() => showToast('Link copied!'));
    }
    // Record share in backend (fire-and-forget)
    fetch(`${API}/social/posts/${postId}/share/`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'copy_link' })
    }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════
//  NEW POST
// ══════════════════════════════════════════════════════════════
function openNewPostModal() {
    document.getElementById('newPostContent').value = '';
    document.getElementById('npCharCount').textContent = '0';
    document.getElementById('npError').style.display = 'none';
    document.getElementById('newPostModal').classList.add('open');
}

function closeNewPostModal() {
    document.getElementById('newPostModal').classList.remove('open');
}

function setPostType(type, btn) {
    newPostType = type;
    document.querySelectorAll('.ptype-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('mediaUrlGroup').style.display = type === 'media' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    const ta = document.getElementById('newPostContent');
    if (ta) ta.addEventListener('input', () => {
        document.getElementById('npCharCount').textContent = ta.value.length;
    });
});

async function submitNewPost() {
    const content = document.getElementById('newPostContent').value.trim();
    if (!content) {
        showNpError('Post content cannot be empty.');
        return;
    }

    const body = { content, post_type: newPostType };
    if (newPostType === 'media') {
        const mu = document.getElementById('newPostMediaUrl').value.trim();
        if (mu) { body.media_url = mu; body.media_type = 'image'; }
    }

    const btn = document.querySelector('.btn-submit-post');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting…';

    try {
        const r = await fetch(`${API}/social/posts/`, {
            method: 'POST',
            headers: { ...authHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!r.ok) {
            const err = await r.json();
            showNpError(Object.values(err).flat().join(' ') || 'Post failed.');
            return;
        }
        closeNewPostModal();
        showToast('Post published ✓');
        loadFeed();
    } catch (e) {
        showNpError('Network error. Try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
    }
}

function showNpError(msg) {
    const el = document.getElementById('npError');
    el.textContent = msg;
    el.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════
//  TOP MEMBERS (uses /api/auth/leaderboard/ or stats)
// ══════════════════════════════════════════════════════════════
async function loadTopMembers(sortBy, btn) {
    // Update button active state
    if (btn) {
        document.querySelectorAll('.top-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    const container = document.getElementById('topList');
    container.innerHTML = '<div class="comm-skeleton"><div class="sk-row"></div><div class="sk-row"></div><div class="sk-row"></div></div>';

    // Map sortBy to the leaderboard endpoint ordering
    const orderMap = { prestige: '-prestige_points', wins: '-tournament_wins', streak: '-current_streak' };
    const order    = orderMap[sortBy] || '-prestige_points';

    try {
        const r = await fetch(`${API}/auth/leaderboard/?ordering=${order}&page_size=15`, { headers: authHeader() });
        if (!r.ok) throw new Error('Leaderboard failed');
        const data    = await r.json();
        const members = data.results || data;

        if (!members.length) {
            container.innerHTML = emptyState('fa-users', 'No members found');
            return;
        }

        container.innerHTML = members.map((m, i) => {
            const rank    = i + 1;
            const rankCls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
            const initials = (m.display_name || m.username || '?')[0].toUpperCase();
            const statVal  = sortBy === 'wins' ? m.tournament_wins
                           : sortBy === 'streak' ? m.current_streak
                           : m.prestige_points;
            const statLbl  = sortBy === 'wins' ? 'Wins' : sortBy === 'streak' ? 'Day streak' : 'Prestige';

            return `
            <div class="top-row" onclick="window.location.href='user.html'">
                <div class="top-rank rank-${rankCls}">${rank <= 3 ? '<i class="fas fa-trophy"></i>' : rank}</div>
                <div class="top-av">
                    ${m.profile_image
                        ? `<img src="${m.profile_image}" alt="av">`
                        : `<span class="av-initial">${initials}</span>`}
                </div>
                <div class="top-info">
                    <span class="top-name">${escHtml(m.display_name || m.username)}</span>
                    <span class="top-badge ${m.access_tier.toLowerCase()}">${m.access_tier}</span>
                </div>
                <div class="top-stat">
                    <span class="ts-val">${Number(statVal).toLocaleString()}</span>
                    <span class="ts-lbl">${statLbl}</span>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = emptyState('fa-triangle-exclamation', 'Could not load members');
    }
}

// ══════════════════════════════════════════════════════════════
//  REWARDS
// ══════════════════════════════════════════════════════════════
function buyReward(name, cost) {
    if (!currentUser) return;
    if (currentUser.prestige_points < cost) {
        showToast(`You need ${cost} pts — you have ${currentUser.prestige_points}`);
        return;
    }
    // Show a non-blocking toast confirmation (no alert/confirm)
    showToast(`✓ ${name} redeemed! (Coming soon via backend)`);
    // Optimistically deduct in UI
    currentUser.prestige_points -= cost;
    setText('shopBalance', currentUser.prestige_points.toLocaleString());
    setText('menuPrestige', currentUser.prestige_points.toLocaleString());
}

// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════
function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60000)    return 'Just now';
    if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000)return `${Math.floor(diff / 86400000)}d ago`;
    return new Date(dateStr).toLocaleDateString();
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function emptyState(icon, msg) {
    return `<div class="comm-empty"><i class="fas ${icon}"></i><span>${msg}</span></div>`;
}

function showToast(msg) {
    const t = document.getElementById('commToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3200);
}

// Close modals on veil click
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('postModal').addEventListener('click', e => {
        if (e.target === document.getElementById('postModal')) closePostModal();
    });
    document.getElementById('newPostModal').addEventListener('click', e => {
        if (e.target === document.getElementById('newPostModal')) closeNewPostModal();
    });
});

// Exports for inline onclick
window.switchTab          = switchTab;
window.loadFeed           = loadFeed;
window.loadMoreFeed       = loadMoreFeed;
window.loadTopMembers     = loadTopMembers;
window.toggleReact        = toggleReact;
window.openPostModal      = openPostModal;
window.closePostModal     = closePostModal;
window.submitComment      = submitComment;
window.sharePost          = sharePost;
window.openNewPostModal   = openNewPostModal;
window.closeNewPostModal  = closeNewPostModal;
window.setPostType        = setPostType;
window.submitNewPost      = submitNewPost;
window.buyReward          = buyReward;
