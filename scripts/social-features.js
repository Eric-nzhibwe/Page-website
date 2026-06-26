/**
 * ARTX Social Features — Comments & Shares
 * Professional, animated, API-first with localStorage fallback.
 */

'use strict';

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────
const SOCIAL_API = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
) ? 'http://localhost:8000/api/social'
  : `${window.location.origin}/api/social`;

function authHeaders() {
    const token = localStorage.getItem('djangoAuthToken');
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Token ${token}`;
    return h;
}

// ─────────────────────────────────────────────────────────────
//  TOAST  (shared with auth, safe to redefine if absent)
// ─────────────────────────────────────────────────────────────
function socialToast(message, type = 'success') {
    if (typeof showToast === 'function') { showToast(message, type); return; }
    let box = document.getElementById('artxToastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'artxToastBox';
        box.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px';
        document.body.appendChild(box);
    }
    const t = document.createElement('div');
    const colors = { success: '#22c55e', error: '#ef4444', info: '#3b82f6' };
    t.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:12px 18px;border-radius:10px;
        font-size:14px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.2);
        opacity:0;transform:translateY(10px);transition:all .3s ease;display:flex;align-items:center;gap:8px`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    t.innerHTML = `<span style="font-size:16px">${icons[type]||icons.info}</span><span>${message}</span>`;
    box.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; });
    setTimeout(() => {
        t.style.opacity = '0'; t.style.transform = 'translateY(10px)';
        setTimeout(() => t.remove(), 300);
    }, 3200);
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);   if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);   if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);   if (d < 7)  return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
}

// Return either the real post id (UUID from API) or the static string id
function resolvePostId(rawId) { return rawId; }

// Returns true if the post only exists locally (never synced to the server)
function _isLocalId(id) {
    return typeof id === 'string' && id.startsWith('local-');
}

// ─────────────────────────────────────────────────────────────
//  REACTIONS (fire toggle on post cards)
// ─────────────────────────────────────────────────────────────
async function reactToPost(postId, reactionType = 'fire') {
    const card  = document.querySelector(`[data-post-id="${postId}"]`);
    const btn   = card?.querySelector('.post-actions .post-action-btn:first-child');
    const counter = card?.querySelector('.post-stats span:first-child');

    // Optimistic UI
    const currentCount = parseInt(counter?.textContent?.match(/\d+/)?.[0] || '0');
    const alreadyReacted = btn?.classList.contains('reacted');

    if (btn) {
        btn.classList.toggle('reacted');
        const newCount = alreadyReacted ? Math.max(0, currentCount - 1) : currentCount + 1;
        if (counter) counter.innerHTML = `<i class="fas fa-fire"></i> ${newCount} reactions`;
        btn.style.transform = 'scale(1.3)';
        setTimeout(() => { btn.style.transform = ''; }, 250);
    }

    try {
        // Try WebSocket first
        const wsOk = wsClient.sendReaction(postId, reactionType);
        if (!wsOk) {
            // Fall back to REST API
            const endpoint = alreadyReacted
                ? `${SOCIAL_API}/posts/${postId}/unreact/`
                : `${SOCIAL_API}/posts/${postId}/react/`;
            await fetch(endpoint, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ reaction_type: reactionType })
            });
        }
    } catch {
        // Rollback optimistic update on failure
        if (btn) {
            btn.classList.toggle('reacted');
            if (counter) counter.innerHTML = `<i class="fas fa-fire"></i> ${currentCount} reactions`;
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  COMMENT MODAL
// ─────────────────────────────────────────────────────────────
let _commentPostId = null;
let _commentPage   = 1;
let _commentTotal  = 0;

function openCommentModal(postId) {
    _commentPostId = postId;
    _commentPage   = 1;

    let modal = document.getElementById('artxCommentModal');
    if (!modal) modal = _buildCommentModal();

    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('modal--visible');
        modal.querySelector('.artx-modal-box').classList.add('modal-box--visible');
    });

    _loadComments(postId, true);
    modal.querySelector('#artxCommentInput').focus();
}

function closeCommentModal() {
    const modal = document.getElementById('artxCommentModal');
    if (!modal) return;
    modal.classList.remove('modal--visible');
    modal.querySelector('.artx-modal-box').classList.remove('modal-box--visible');
    setTimeout(() => {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 280);
    _commentPostId = null;
}

function _buildCommentModal() {
    const el = document.createElement('div');
    el.id        = 'artxCommentModal';
    el.className = 'artx-modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Comments');
    el.innerHTML = `
      <div class="artx-modal-box" role="document">

        <!-- Header -->
        <div class="artx-modal-head">
          <h3 class="artx-modal-title"><i class="fas fa-comment-dots"></i> Comments</h3>
          <button class="artx-modal-close" onclick="closeCommentModal()" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Comment list -->
        <div class="artx-comments-wrap" id="artxCommentsList">
          <div class="artx-comments-skeleton">
            ${[1,2,3].map(() => `
              <div class="artx-comment-skel">
                <div class="skel-avatar"></div>
                <div class="skel-lines"><div class="skel-line skel-line--w70"></div><div class="skel-line skel-line--w40"></div></div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Load more -->
        <div class="artx-load-more-wrap" id="artxLoadMoreWrap" style="display:none">
          <button class="artx-load-more-btn" id="artxLoadMoreBtn" onclick="_loadMoreComments()">
            Load more comments
          </button>
        </div>

        <!-- Composer -->
        <div class="artx-composer">
          <div class="artx-composer-avatar"><i class="fas fa-user-circle"></i></div>
          <div class="artx-composer-inner">
            <textarea id="artxCommentInput" class="artx-composer-textarea"
              placeholder="Write a comment…" maxlength="1000" rows="1"
              oninput="_autoResize(this); _updateCharCount(this)"></textarea>
            <div class="artx-composer-footer">
              <span class="artx-char-count" id="artxCharCount">0 / 1000</span>
              <button class="artx-send-btn" id="artxSendBtn" onclick="_submitComment()" aria-label="Post comment">
                <i class="fas fa-paper-plane"></i> Post
              </button>
            </div>
          </div>
        </div>

      </div>`;

    // Close on backdrop click
    el.addEventListener('click', e => { if (e.target === el) closeCommentModal(); });
    // Close on Escape
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closeCommentModal(); });

    document.body.appendChild(el);
    return el;
}

// Auto-grow textarea
function _autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function _updateCharCount(el) {
    const count = document.getElementById('artxCharCount');
    if (count) count.textContent = `${el.value.length} / 1000`;
}

async function _loadComments(postId, reset = false) {
    const list  = document.getElementById('artxCommentsList');
    const moreW = document.getElementById('artxLoadMoreWrap');

    if (reset) {
        list.innerHTML = '<div class="artx-comments-skeleton">' +
            [1,2,3].map(() => `<div class="artx-comment-skel">
              <div class="skel-avatar"></div>
              <div class="skel-lines"><div class="skel-line skel-line--w70"></div><div class="skel-line skel-line--w40"></div></div>
            </div>`).join('') + '</div>';
    }

    // ── Local-only posts: skip the API entirely ──
    if (_isLocalId(postId)) {
        const all  = JSON.parse(localStorage.getItem('artxComments') || '{}');
        const cmts = (all[postId] || []).slice().reverse();
        if (reset) list.innerHTML = '';
        if (cmts.length === 0 && reset) {
            list.innerHTML = '<p class="artx-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
            if (moreW) moreW.style.display = 'none';
        } else {
            cmts.forEach(c => list.appendChild(_makeCommentEl(c)));
            if (moreW) moreW.style.display = 'none';
        }
        return;
    }

    // ── Try real API first ──
    try {
        const res = await fetch(`${SOCIAL_API}/comments/?post_id=${postId}&page=${_commentPage}`, {
            headers: authHeaders()
        });

        if (res.ok) {
            const data = await res.json();
            const comments = Array.isArray(data) ? data : (data.results || []);
            _commentTotal  = data.count ?? comments.length;

            if (reset) list.innerHTML = '';

            if (comments.length === 0 && reset) {
                list.innerHTML = '<p class="artx-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
                if (moreW) moreW.style.display = 'none';
                return;
            }

            comments.forEach(c => list.appendChild(_makeCommentEl(c)));

            const shown = list.querySelectorAll('.artx-comment-item').length;
            if (moreW) moreW.style.display = shown < _commentTotal ? 'flex' : 'none';
            return;
        }
    } catch { /* fall through to local */ }

    // ── localStorage fallback ──
    const all  = JSON.parse(localStorage.getItem('artxComments') || '{}');
    const cmts = (all[postId] || []).slice().reverse();

    if (reset) list.innerHTML = '';

    if (cmts.length === 0 && reset) {
        list.innerHTML = '<p class="artx-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
        if (moreW) moreW.style.display = 'none';
        return;
    }

    cmts.forEach(c => list.appendChild(_makeCommentEl(c)));
    if (moreW) moreW.style.display = 'none';
}

function _loadMoreComments() {
    _commentPage++;
    _loadComments(_commentPostId, false);
}

function _makeCommentEl(c) {
    const author   = c.author || {};
    const name     = esc(author.display_name || author.username || c.username || 'User');
    const text     = esc(c.content || c.text || '');
    const when     = timeAgo(c.created_at || c.timestamp || new Date().toISOString());
    const hasAvatar = author.profile_image;

    const div = document.createElement('div');
    div.className = 'artx-comment-item';
    div.dataset.commentId = c.id || '';
    div.innerHTML = `
      <div class="artx-comment-avatar">
        ${hasAvatar
            ? `<img src="${esc(author.profile_image)}" alt="${name}">`
            : `<i class="fas fa-user-circle"></i>`}
      </div>
      <div class="artx-comment-body">
        <div class="artx-comment-bubble">
          <span class="artx-comment-name">${name}</span>
          <p class="artx-comment-text">${text}</p>
        </div>
        <div class="artx-comment-meta">
          <span class="artx-comment-time">${when}</span>
          <button class="artx-comment-react-btn" onclick="_reactToComment('${c.id || ''}', this)">
            <i class="fas fa-fire"></i> ${c.reaction_count || 0}
          </button>
          <button class="artx-comment-reply-btn" onclick="_startReply('${c.id || ''}', '${name}')">
            <i class="fas fa-reply"></i> Reply
          </button>
        </div>
      </div>`;
    return div;
}

async function _submitComment() {
    const input   = document.getElementById('artxCommentInput');
    const sendBtn = document.getElementById('artxSendBtn');
    const text    = input.value.trim();

    if (!text) { input.focus(); return; }
    if (!_commentPostId) return;

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

    const newComment = {
        id:         `local-${Date.now()}`,
        content:    text,
        text:       text,
        author:     { username: _getCurrentUsername() },
        username:   _getCurrentUsername(),
        created_at: new Date().toISOString(),
        timestamp:  new Date().toISOString(),
        reaction_count: 0
    };

    // Always reset the button at the end, no matter what
    const _resetBtn = () => {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
    };

    try {
        // ── Try WebSocket first (instant, real-time) ──
        let postedViaWS = false;
        if (wsClient.feedConnected || wsClient._postConns?.has(String(_commentPostId))) {
            if (!wsClient._postConns?.has(String(_commentPostId))) {
                wsClient.connectToPost(_commentPostId, {
                    onComment: c => {
                        const list = document.getElementById('artxCommentsList');
                        if (!list) return;
                        const el = _makeCommentEl(c);
                        el.classList.add('artx-comment--new');
                        list.appendChild(el);
                    }
                });
            }
            postedViaWS = wsClient.sendComment(_commentPostId, text);
        }

        if (postedViaWS) {
            const list = document.getElementById('artxCommentsList');
            const emptyMsg = list?.querySelector('.artx-empty-msg');
            if (emptyMsg) emptyMsg.remove();
            if (list) {
                const el = _makeCommentEl(newComment);
                el.classList.add('artx-comment--new');
                list.appendChild(el);
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            _bumpCount(_commentPostId, 'comment');
            input.value = '';
            input.style.height = 'auto';
            _updateCharCount(input);
            _resetBtn();
            socialToast('Comment posted! 💬', 'success');
            return;
        }

        // ── Fallback: REST API ──
        let posted = false;
        if (!_isLocalId(_commentPostId)) {
            try {
                const res = await fetch(`${SOCIAL_API}/comments/`, {
                    method:  'POST',
                    headers: authHeaders(),
                    body:    JSON.stringify({ post_id: _commentPostId, content: text })
                });
                if (res.ok) {
                    const data = await res.json();
                    Object.assign(newComment, data);
                    posted = true;
                }
            } catch { /* network error — fall through to local save */ }
        }

        if (!posted) {
            const all = JSON.parse(localStorage.getItem('artxComments') || '{}');
            if (!all[_commentPostId]) all[_commentPostId] = [];
            all[_commentPostId].push(newComment);
            localStorage.setItem('artxComments', JSON.stringify(all));
        }

        // Inject into list
        const list = document.getElementById('artxCommentsList');
        if (list) {
            const emptyMsg = list.querySelector('.artx-empty-msg');
            if (emptyMsg) emptyMsg.remove();
            const el = _makeCommentEl(newComment);
            el.classList.add('artx-comment--new');
            list.appendChild(el);
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        _bumpCount(_commentPostId, 'comment');
        input.value = '';
        input.style.height = 'auto';
        _updateCharCount(input);
        socialToast('Comment posted! 💬', 'success');

    } finally {
        // Guaranteed to run — spinner always stops
        _resetBtn();
    }
}

async function _reactToComment(commentId, btn) {
    if (!commentId || commentId.startsWith('local-')) return;
    btn.classList.toggle('reacted');
    const cur = parseInt(btn.textContent) || 0;
    btn.innerHTML = `<i class="fas fa-fire"></i> ${btn.classList.contains('reacted') ? cur + 1 : Math.max(0, cur - 1)}`;

    try {
        await fetch(`${SOCIAL_API}/comments/${commentId}/react/`, {
            method:  'POST',
            headers: authHeaders(),
            body:    JSON.stringify({ reaction_type: 'fire' })
        });
    } catch { /* silent */ }
}

function _startReply(parentId, authorName) {
    const input = document.getElementById('artxCommentInput');
    if (!input) return;
    input.value = `@${authorName} `;
    input.dataset.parentId = parentId;
    input.focus();
    _autoResize(input);
    _updateCharCount(input);
}

function _getCurrentUsername() {
    try {
        const u = JSON.parse(localStorage.getItem('artxUser') || '{}');
        return u.username || u.display_name || 'You';
    } catch { return 'You'; }
}

// ─────────────────────────────────────────────────────────────
//  SHARE MODAL
// ─────────────────────────────────────────────────────────────
let _sharePostId = null;
let _shareUrls   = {};

function openShareModal(postId) {
    _sharePostId = postId;

    let modal = document.getElementById('artxShareModal');
    if (!modal) modal = _buildShareModal();

    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('modal--visible');
        modal.querySelector('.artx-modal-box').classList.add('modal-box--visible');
    });

    _loadShareUrls(postId);
}

function closeShareModal() {
    const modal = document.getElementById('artxShareModal');
    if (!modal) return;
    modal.classList.remove('modal--visible');
    modal.querySelector('.artx-modal-box').classList.remove('modal-box--visible');
    setTimeout(() => {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 280);
    _sharePostId = null;
    _shareUrls   = {};
}

function _buildShareModal() {
    const el = document.createElement('div');
    el.id        = 'artxShareModal';
    el.className = 'artx-modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Share post');
    el.innerHTML = `
      <div class="artx-modal-box artx-modal-box--share" role="document">

        <div class="artx-modal-head">
          <h3 class="artx-modal-title"><i class="fas fa-share-alt"></i> Share Post</h3>
          <button class="artx-modal-close" onclick="closeShareModal()" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Share platform grid -->
        <div class="artx-share-grid">
          <button class="artx-share-tile artx-share-tile--fb"       onclick="_shareVia('facebook')">
            <i class="fab fa-facebook-f"></i><span>Facebook</span>
          </button>
          <button class="artx-share-tile artx-share-tile--wa"       onclick="_shareVia('whatsapp')">
            <i class="fab fa-whatsapp"></i><span>WhatsApp</span>
          </button>
          <button class="artx-share-tile artx-share-tile--x"        onclick="_shareVia('x')">
            <i class="fab fa-x-twitter"></i><span>X / Twitter</span>
          </button>
          <button class="artx-share-tile artx-share-tile--tg"       onclick="_shareVia('telegram')">
            <i class="fab fa-telegram-plane"></i><span>Telegram</span>
          </button>
          <button class="artx-share-tile artx-share-tile--copy"     onclick="_shareVia('copy_link')" id="artxCopyBtn">
            <i class="fas fa-link"></i><span>Copy Link</span>
          </button>
          <button class="artx-share-tile artx-share-tile--native"   onclick="_nativeShare()"
            id="artxNativeBtn" style="display:none">
            <i class="fas fa-share"></i><span>More…</span>
          </button>
        </div>

        <!-- URL bar -->
        <div class="artx-share-url-bar">
          <input class="artx-share-url-input" id="artxShareUrlInput" readonly value="Generating link…">
          <button class="artx-share-url-copy" onclick="_copyFromInput()" aria-label="Copy link">
            <i class="fas fa-copy"></i>
          </button>
        </div>

        <!-- Share count feedback -->
        <p class="artx-share-note" id="artxShareNote"></p>

      </div>`;

    el.addEventListener('click', e => { if (e.target === el) closeShareModal(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closeShareModal(); });

    // Show native share if available
    if (navigator.share) {
        const nb = el.querySelector('#artxNativeBtn');
        if (nb) nb.style.display = '';
    }

    document.body.appendChild(el);
    return el;
}

async function _loadShareUrls(postId) {
    const input = document.getElementById('artxShareUrlInput');
    const fallbackUrl = `${window.location.origin}/posts/${postId}`;

    try {
        const res = await fetch(`${SOCIAL_API}/posts/${postId}/share_urls/`, {
            headers: authHeaders()
        });
        if (res.ok) {
            _shareUrls = await res.json();
            if (input) input.value = _shareUrls.copy_link || fallbackUrl;
            return;
        }
    } catch { /* fall through */ }

    // Fallback: build URLs client-side
    const text = encodeURIComponent('Check out this post on ARTX! 🔥');
    const url  = encodeURIComponent(fallbackUrl);
    _shareUrls = {
        facebook:  `https://www.facebook.com/sharer/sharer.php?u=${url}`,
        whatsapp:  `https://wa.me/?text=${text}%20${url}`,
        x:         `https://twitter.com/intent/tweet?text=${text}&url=${url}`,
        telegram:  `https://t.me/share/url?url=${url}&text=${text}`,
        copy_link: fallbackUrl
    };
    if (input) input.value = fallbackUrl;
}

async function _shareVia(platform) {
    const url = _shareUrls[platform] || _shareUrls.copy_link || window.location.href;

    if (platform === 'copy_link') {
        await _copyText(_shareUrls.copy_link || window.location.href);
        _animateCopyBtn();
        await _recordShare(platform);
        socialToast('Link copied! 🔗', 'success');
        return;
    }

    window.open(url, `artx-share-${platform}`, 'width=620,height=480,resizable=yes');
    await _recordShare(platform);
    socialToast(`Opening ${_platformLabel(platform)}…`, 'info');

    // Close after short delay so user sees the toast
    setTimeout(closeShareModal, 800);
}

async function _nativeShare() {
    const shareUrl = _shareUrls.copy_link || window.location.href;
    try {
        await navigator.share({ title: 'ARTX Post', text: 'Check out this post on ARTX! 🔥', url: shareUrl });
        await _recordShare('native');
        socialToast('Shared successfully! 🎉', 'success');
    } catch (e) {
        if (e.name !== 'AbortError') socialToast('Share cancelled.', 'info');
    }
}

async function _copyFromInput() {
    const input = document.getElementById('artxShareUrlInput');
    if (!input) return;
    await _copyText(input.value);
    _animateCopyBtn();
    socialToast('Link copied! 🔗', 'success');
}

async function _copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
    }
}

function _animateCopyBtn() {
    const btn = document.getElementById('artxCopyBtn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i><span>Copied!</span>';
    btn.classList.add('artx-share-tile--copied');
    setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('artx-share-tile--copied');
    }, 2000);
}

async function _recordShare(platform) {
    _bumpCount(_sharePostId, 'share');
    // Try WebSocket first, then REST
    const wsOk = wsClient.sendShare(_sharePostId, platform);
    if (!wsOk) {
        try {
            await fetch(`${SOCIAL_API}/posts/${_sharePostId}/share/`, {
                method:  'POST',
                headers: authHeaders(),
                body:    JSON.stringify({ platform })
            });
        } catch { /* silent */ }
    }
}

function _platformLabel(p) {
    return { facebook: 'Facebook', whatsapp: 'WhatsApp', x: 'X / Twitter', telegram: 'Telegram' }[p] || p;
}

// ─────────────────────────────────────────────────────────────
//  SHARED COUNT BUMP (optimistic DOM update)
// ─────────────────────────────────────────────────────────────
function _bumpCount(postId, type) {
    const card = document.querySelector(`[data-post-id="${postId}"]`);
    if (!card) return;

    if (type === 'comment') {
        const el = card.querySelector('.comment-count');
        if (el) el.textContent = (parseInt(el.textContent) || 0) + 1;
    } else if (type === 'share') {
        const el = card.querySelector('.share-count');
        if (el) el.textContent = (parseInt(el.textContent) || 0) + 1;
    }
}

// ─────────────────────────────────────────────────────────────
//  KEYBOARD & FOCUS TRAP
// ─────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const active = document.querySelector('.artx-modal-overlay.modal--visible');
    if (!active) return;
    const focusable = active.querySelectorAll(
        'button:not([disabled]),textarea,input,[tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { last.focus(); e.preventDefault(); } }
    else            { if (document.activeElement === last)  { first.focus(); e.preventDefault(); } }
});

// ─────────────────────────────────────────────────────────────
//  EXPOSE GLOBALS  (called from inline onclick in index.html)
// ─────────────────────────────────────────────────────────────
window.openCommentModal  = openCommentModal;
window.closeCommentModal = closeCommentModal;
window.openShareModal    = openShareModal;
window.closeShareModal   = closeShareModal;
window.reactToPost       = reactToPost;

// Internal handlers called from dynamically-created modal HTML
window._submitComment    = _submitComment;
window._loadMoreComments = _loadMoreComments;
window._reactToComment   = _reactToComment;
window._startReply       = _startReply;
window._autoResize       = _autoResize;
window._updateCharCount  = _updateCharCount;
window._shareVia         = _shareVia;
window._nativeShare      = _nativeShare;
window._copyFromInput    = _copyFromInput;
