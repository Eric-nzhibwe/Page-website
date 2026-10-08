/**
 * PAGE Social Features — Comments & Shares
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
    let box = document.getElementById('pageToastBox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'pageToastBox';
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
//  REACTIONS  — hold-to-pick, tap-to-toggle
// ─────────────────────────────────────────────────────────────

// Map each reaction type to its icon class + display colour
const _REACTION_META = {
    fire:      { icon: 'fas fa-fire',            label: 'Fire',      color: '#f97316' },
    heart:     { icon: 'fas fa-heart',           label: 'Heart',     color: '#e63946' },
    handshake: { icon: 'fas fa-handshake',       label: 'Respect',   color: '#6c63ff' },
    laugh:     { icon: 'fas fa-laugh-squint',    label: 'Haha',      color: '#f59e0b' },
    like:      { icon: 'fas fa-thumbs-up',       label: 'Like',      color: '#3b82f6' },
    wow:       { icon: 'fas fa-surprise',        label: 'Wow',       color: '#8b5cf6' },
    sad:       { icon: 'fas fa-sad-tear',        label: 'Sad',       color: '#64748b' },
};

/**
 * Apply a chosen reaction type's appearance to the reaction button.
 * Called on page-load (from user_reaction) and after a reaction is made.
 */
function _applyReactionToBtn(btn, reactionType) {
    const meta = _REACTION_META[reactionType] || _REACTION_META.fire;
    const icon = btn.querySelector('i');
    const lbl  = btn.querySelector('span');
    if (icon) { icon.className = meta.icon; }
    if (lbl)  { lbl.textContent = meta.label; }
    btn.style.color = meta.color;
    btn.dataset.activeReaction = reactionType;
}

/**
 * Reset the reaction button to its default un-reacted state.
 */
function _clearReactionBtn(btn) {
    const icon = btn.querySelector('i');
    const lbl  = btn.querySelector('span');
    if (icon) { icon.className = 'fas fa-fire'; }
    if (lbl)  { lbl.textContent = 'React'; }
    btn.style.color = '';
    btn.dataset.activeReaction = '';
}

/**
 * Show the floating reaction picker above the reaction button.
 * Triggered by a single click. Dismissed by clicking outside or picking.
 */
function _showReactionPicker(postId, btn) {
    // If picker for this post is already open, close it (toggle)
    const existing = document.querySelector(`.reaction-picker[data-for-post="${postId}"]`);
    if (existing) { existing.remove(); return; }

    // Close any other open pickers first
    document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.setAttribute('data-for-post', postId);

    const options = ['fire', 'heart', 'handshake', 'laugh'];
    options.forEach(type => {
        const meta = _REACTION_META[type];
        const item = document.createElement('button');
        item.className = 'reaction-picker-item';
        item.title = meta.label;
        item.dataset.type = type;
        item.innerHTML = `<i class="${meta.icon}"></i><span>${meta.label}</span>`;
        item.style.setProperty('--reaction-color', meta.color);
        item.addEventListener('click', e => {
            e.stopPropagation();
            picker.remove();
            reactToPost(postId, type);
        });
        picker.appendChild(item);
    });

    document.body.appendChild(picker);

    // Position above the button
    const rect = btn.getBoundingClientRect();
    picker.style.visibility = 'hidden';   // measure without flicker
    picker.style.position   = 'fixed';    // use fixed so no scrollY math needed
    picker.style.left = '0';
    picker.style.top  = '0';
    // Force layout so offsetWidth/Height are real
    requestAnimationFrame(() => {
        const pw = picker.offsetWidth  || 220;
        const ph = picker.offsetHeight || 60;
        let left = rect.left + rect.width / 2 - pw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
        const top  = rect.top - ph - 10;
        picker.style.left       = `${left}px`;
        picker.style.top        = `${top}px`;
        picker.style.visibility = '';
    });

    // Dismiss on outside click
    const dismiss = e => {
        if (!picker.contains(e.target) && e.target !== btn) {
            picker.remove();
            document.removeEventListener('click', dismiss, true);
        }
    };
    // Use capture so it runs before other handlers
    setTimeout(() => document.addEventListener('click', dismiss, true), 50);
}

/**
 * Attach single-click-to-open-picker behaviour to a reaction button.
 * First click → show picker
 * Clicking the active reaction in the picker → unreact
 * Clicking outside → close picker
 */
function _attachReactClick(btn, postId) {
    if (btn._reactClickAttached) return;
    btn._reactClickAttached = true;

    btn.addEventListener('click', e => {
        e.stopPropagation();
        _showReactionPicker(postId, btn);
    });
}

async function reactToPost(postId, reactionType = 'fire') {
    const card    = document.querySelector(`[data-post-id="${postId}"]`);
    const btn     = card?.querySelector('.reaction-btn');
    const rSpan   = card?.querySelector('.reaction-count');

    // Determine current state
    const currentType    = btn?.dataset.activeReaction || '';
    const alreadyReacted = !!currentType;
    // If same type tapped again → unreact; different type → switch reaction
    const isUnreact      = alreadyReacted && currentType === reactionType;

    // ── Optimistic UI ────────────────────────────────────────────────────────
    const currentCount = parseInt(rSpan?.textContent || '0') || 0;
    if (btn) {
        if (isUnreact) {
            btn.classList.remove('reacted');
            _clearReactionBtn(btn);
            if (rSpan) rSpan.textContent = Math.max(0, currentCount - 1);
        } else {
            btn.classList.add('reacted');
            _applyReactionToBtn(btn, reactionType);
            if (rSpan) rSpan.textContent = alreadyReacted ? currentCount : currentCount + 1;
        }
        btn.style.transform = 'scale(1.3)';
        setTimeout(() => { btn.style.transform = ''; }, 250);
    }

    // ── API call ─────────────────────────────────────────────────────────────
    try {
        const wsOk = (typeof wsClient !== 'undefined') && wsClient.sendReaction?.(postId, reactionType);
        if (!wsOk) {
            const endpoint = isUnreact
                ? `${SOCIAL_API}/posts/${postId}/unreact/`
                : `${SOCIAL_API}/posts/${postId}/react/`;
            await fetch(endpoint, {
                method:  'POST',
                headers: authHeaders(),
                body:    JSON.stringify({ reaction_type: reactionType }),
            });
        }
    } catch {
        // Rollback on failure
        if (btn) {
            if (isUnreact) {
                btn.classList.add('reacted');
                _applyReactionToBtn(btn, currentType);
                if (rSpan) rSpan.textContent = currentCount;
            } else {
                if (!alreadyReacted) {
                    btn.classList.remove('reacted');
                    _clearReactionBtn(btn);
                    if (rSpan) rSpan.textContent = currentCount;
                }
            }
        }
    }
}

/**
 * Initialise all reaction buttons currently in the DOM.
 * Also called after new cards are inserted (MutationObserver or explicit call).
 */
function initReactButtons() {
    document.querySelectorAll('.reaction-btn[data-post-id]').forEach(btn => {
        const postId = btn.dataset.postId;
        _attachReactClick(btn, postId);
        // Apply saved reaction state from data attribute set during card render
        const savedType = btn.dataset.activeReaction;
        if (savedType && savedType !== '') {
            btn.classList.add('reacted');
            _applyReactionToBtn(btn, savedType);
        }
    });
}

// Run once on load and observe future card insertions
document.addEventListener('DOMContentLoaded', () => {
    initReactButtons();
    const observer = new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            (n.matches?.('.reaction-btn') ? [n] : [...n.querySelectorAll('.reaction-btn[data-post-id]')])
                .forEach(btn => {
                    _attachReactClick(btn, btn.dataset.postId);
                    if (btn.dataset.activeReaction) {
                        btn.classList.add('reacted');
                        _applyReactionToBtn(btn, btn.dataset.activeReaction);
                    }
                });
        }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
});

// ─────────────────────────────────────────────────────────────
//  COMMENT MODAL
// ─────────────────────────────────────────────────────────────
let _commentPostId = null;
let _commentPage   = 1;
let _commentTotal  = 0;

function openCommentModal(postId) {
    _commentPostId = postId;
    _commentPage   = 1;

    let modal = document.getElementById('pageCommentModal');
    if (!modal) modal = _buildCommentModal();

    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('modal--visible');
        modal.querySelector('.page-modal-box').classList.add('modal-box--visible');
    });

    _loadComments(postId, true).then(() => _startCommentPoller(postId));
    modal.querySelector('#pageCommentInput').focus();
}

function closeCommentModal() {
    const modal = document.getElementById('pageCommentModal');
    if (!modal) return;
    modal.classList.remove('modal--visible');
    modal.querySelector('.page-modal-box').classList.remove('modal-box--visible');
    setTimeout(() => {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 280);
    _stopCommentPoller();   // stop the 8-second comment poll
    _commentPostId = null;
}

function _buildCommentModal() {
    const el = document.createElement('div');
    el.id        = 'pageCommentModal';
    el.className = 'page-modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Comments');
    el.innerHTML = `
      <div class="page-modal-box" role="document">

        <!-- Header -->
        <div class="page-modal-head">
          <h3 class="page-modal-title"><i class="fas fa-comment-dots"></i> Comments</h3>
          <button class="page-modal-close" onclick="closeCommentModal()" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Comment list -->
        <div class="page-comments-wrap" id="pageCommentsList">
          <div class="page-comments-skeleton">
            ${[1,2,3].map(() => `
              <div class="page-comment-skel">
                <div class="skel-avatar"></div>
                <div class="skel-lines"><div class="skel-line skel-line--w70"></div><div class="skel-line skel-line--w40"></div></div>
              </div>`).join('')}
          </div>
        </div>

        <!-- Load more -->
        <div class="page-load-more-wrap" id="pageLoadMoreWrap" style="display:none">
          <button class="page-load-more-btn" id="pageLoadMoreBtn" onclick="_loadMoreComments()">
            Load more comments
          </button>
        </div>

        <!-- Composer -->
        <div class="page-composer">
          <div class="page-composer-avatar" data-current-user-avatar>
            <i class="fas fa-user-circle"></i>
          </div>
          <div class="page-composer-inner">
            <textarea id="pageCommentInput" class="page-composer-textarea"
              placeholder="Write a comment…" maxlength="1000" rows="1"
              oninput="_autoResize(this); _updateCharCount(this)"></textarea>
            <div class="page-composer-footer">
              <span class="page-char-count" id="pageCharCount">0 / 1000</span>
              <button class="page-send-btn" id="pageSendBtn" onclick="_submitComment()" aria-label="Post comment">
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

    // Stamp the current user's avatar in the composer immediately after building
    try {
        const user = JSON.parse(localStorage.getItem('pageUser') || '{}');
        const url  = user.profile_image_url || user.profile_image || null;
        if (url && window._stampCurrentUserAvatar) window._stampCurrentUserAvatar(url);
    } catch (_) { /* non-critical */ }

    return el;
}

// Auto-grow textarea
function _autoResize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

function _updateCharCount(el) {
    const count = document.getElementById('pageCharCount');
    if (count) count.textContent = `${el.value.length} / 1000`;
}

async function _loadComments(postId, reset = false) {
    const list  = document.getElementById('pageCommentsList');
    const moreW = document.getElementById('pageLoadMoreWrap');

    if (reset) {
        list.innerHTML = '<div class="page-comments-skeleton">' +
            [1,2,3].map(() => `<div class="page-comment-skel">
              <div class="skel-avatar"></div>
              <div class="skel-lines"><div class="skel-line skel-line--w70"></div><div class="skel-line skel-line--w40"></div></div>
            </div>`).join('') + '</div>';
    }

    // ── Local-only posts: skip the API entirely ──
    if (_isLocalId(postId)) {
        const all  = JSON.parse(localStorage.getItem('pageComments') || '{}');
        const cmts = (all[postId] || []).slice().reverse();
        if (reset) list.innerHTML = '';
        if (cmts.length === 0 && reset) {
            list.innerHTML = '<p class="page-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
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
                list.innerHTML = '<p class="page-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
                if (moreW) moreW.style.display = 'none';
                return;
            }

            comments.forEach(c => list.appendChild(_makeCommentEl(c)));

            const shown = list.querySelectorAll('.page-comment-item').length;
            if (moreW) moreW.style.display = shown < _commentTotal ? 'flex' : 'none';
            return;
        }
    } catch { /* fall through to local */ }

    // ── localStorage fallback ──
    const all  = JSON.parse(localStorage.getItem('pageComments') || '{}');
    const cmts = (all[postId] || []).slice().reverse();

    if (reset) list.innerHTML = '';

    if (cmts.length === 0 && reset) {
        list.innerHTML = '<p class="page-empty-msg"><i class="fas fa-comment-slash"></i> No comments yet — be the first!</p>';
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
    const author  = c.author || {};
    const name    = esc(author.display_name || author.username || c.username || 'User');
    const text    = esc(c.content || c.text || '');
    const when    = timeAgo(c.created_at || c.timestamp || new Date().toISOString());
    // prefer profile_image_url (avatar_url / base64) over legacy profile_image
    const avatarUrl = author.profile_image_url || author.avatar_url
        || (author.profile_image && !author.profile_image.startsWith('/media/')
            ? author.profile_image : null);

    const div = document.createElement('div');
    div.className = 'page-comment-item';
    div.dataset.commentId = c.id || '';
    div.innerHTML = `
      <div class="page-comment-avatar">
        ${avatarUrl
            ? `<img src="${esc(avatarUrl)}" alt="${name}"
                   onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fas fa-user-circle\\'></i>'">`
            : `<i class="fas fa-user-circle"></i>`}
      </div>
      <div class="page-comment-body">
        <div class="page-comment-bubble">
          <span class="page-comment-name">${name}</span>
          <p class="page-comment-text">${text}</p>
        </div>
        <div class="page-comment-meta">
          <span class="page-comment-time">${when}</span>
          <button class="page-comment-react-btn" onclick="_reactToComment('${c.id || ''}', this)">
            <i class="fas fa-fire"></i> ${c.reaction_count || 0}
          </button>
          <button class="page-comment-reply-btn" onclick="_startReply('${c.id || ''}', '${name}')">
            <i class="fas fa-reply"></i> Reply
          </button>
        </div>
      </div>`;
    return div;
}

// Hoisted so _submitComment can reference them before the poller section
let _commentPollTimer = null;
let _seenCommentIds   = new Set();

async function _submitComment() {
    const input   = document.getElementById('pageCommentInput');
    const sendBtn = document.getElementById('pageSendBtn');
    const text    = input.value.trim();

    if (!text) { input.focus(); return; }
    if (!_commentPostId) return;

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';

    const _resetBtn = () => {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Post';
    };

    // ── Build optimistic comment from localStorage user data ─────────────────
    const _storedUser = (() => { try { return JSON.parse(localStorage.getItem('pageUser') || '{}'); } catch { return {}; } })();
    const optimistic = {
        id:             `optimistic-${Date.now()}`,
        content:        text,
        author: {
            username:          _storedUser.username    || 'You',
            display_name:      _storedUser.display_name || _storedUser.username || 'You',
            profile_image_url: _storedUser.profile_image_url || _storedUser.profile_image || null,
        },
        created_at:     new Date().toISOString(),
        reaction_count: 0,
    };

    // ── Inject bubble immediately (no waiting for API) ────────────────────────
    const list     = document.getElementById('pageCommentsList');
    const emptyMsg = list?.querySelector('.page-empty-msg');
    if (emptyMsg) emptyMsg.remove();

    const optEl = _makeCommentEl(optimistic);
    optEl.classList.add('page-comment--new');
    optEl.dataset.optimistic = '1';
    if (list) {
        list.appendChild(optEl);
        optEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Bump count on feed card immediately
    _bumpCount(_commentPostId, 'comment');

    // Clear input right away so user can keep typing
    input.value = '';
    input.style.height = 'auto';
    _updateCharCount(input);

    try {
        if (!_isLocalId(_commentPostId)) {
            const res = await fetch(`${SOCIAL_API}/comments/`, {
                method:  'POST',
                headers: authHeaders(),
                body:    JSON.stringify({ post_id: _commentPostId, content: text }),
            });
            if (res.ok) {
                const saved = await res.json();
                // Replace optimistic element with real one to get a correct id
                const realEl = _makeCommentEl(saved);
                realEl.classList.add('page-comment--new');
                optEl.replaceWith(realEl);
                // Now that we have the real id, add it to seen-set so the poller
                // doesn't insert a duplicate when it next fires
                _seenCommentIds.add(String(saved.id));
                socialToast('Comment posted! 💬', 'success');
                _resetBtn();
                return;
            }
        }
        // localStorage fallback (local-id posts or API failure)
        const all = JSON.parse(localStorage.getItem('pageComments') || '{}');
        if (!all[_commentPostId]) all[_commentPostId] = [];
        all[_commentPostId].push({ ...optimistic, id: `local-${Date.now()}` });
        localStorage.setItem('pageComments', JSON.stringify(all));
        socialToast('Comment posted! 💬', 'success');

    } catch {
        // Network error — mark bubble as failed and let user retry
        optEl.style.opacity = '0.6';
        const errNote = document.createElement('p');
        errNote.style.cssText = 'color:#e63946;font-size:11px;margin:4px 0 0 0;cursor:pointer;';
        errNote.textContent = '⚠️ Not saved — tap to retry';
        errNote.onclick = () => {
            optEl.remove();
            input.value = text;
            _autoResize(input);
            _updateCharCount(input);
            input.focus();
        };
        optEl.querySelector('.page-comment-body')?.appendChild(errNote);
    } finally {
        _resetBtn();
    }
}

// ─────────────────────────────────────────────────────────────
//  REAL-TIME COMMENT POLLING
//  While the comment modal is open, poll every 8 s and inject
//  any new comments from other users without wiping the list.
// ─────────────────────────────────────────────────────────────

function _startCommentPoller(postId) {
    _stopCommentPoller();
    _seenCommentIds.clear();

    // Seed with ids already rendered so we never duplicate them
    document.querySelectorAll('#pageCommentsList .page-comment-item').forEach(el => {
        if (el.dataset.commentId && !el.dataset.optimistic) {
            _seenCommentIds.add(String(el.dataset.commentId));
        }
    });

    if (!postId || _isLocalId(postId)) return;
    _commentPollTimer = setInterval(() => _pollNewComments(postId), 8_000);
}

function _stopCommentPoller() {
    if (_commentPollTimer) { clearInterval(_commentPollTimer); _commentPollTimer = null; }
}

async function _pollNewComments(postId) {
    if (!postId || _isLocalId(postId)) return;
    try {
        const res = await fetch(`${SOCIAL_API}/comments/?post_id=${postId}&page=1`, {
            headers: authHeaders(),
        });
        if (!res.ok) return;
        const data     = await res.json();
        const comments = Array.isArray(data) ? data : (data.results || []);

        const list = document.getElementById('pageCommentsList');
        if (!list) return;

        let added = 0;
        comments.forEach(c => {
            const id = String(c.id);
            if (_seenCommentIds.has(id)) return;
            // Skip if the slot is currently held by an optimistic bubble —
            // _submitComment will replace it once the API responds
            if (list.querySelector('[data-optimistic="1"]')) return;

            _seenCommentIds.add(id);
            const emptyMsg = list.querySelector('.page-empty-msg');
            if (emptyMsg) emptyMsg.remove();

            const el = _makeCommentEl(c);
            el.classList.add('page-comment--new');
            list.appendChild(el);
            added++;
        });

        // Keep comment count on the feed card accurate
        if (added > 0) {
            const total = data.count ?? comments.length;
            const card  = document.querySelector(`[data-post-id="${postId}"]`);
            const cEl   = card?.querySelector('.comment-count');
            if (cEl) cEl.textContent = total;
        }
    } catch { /* silent — offline is fine */ }
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
    const input = document.getElementById('pageCommentInput');
    if (!input) return;
    input.value = `@${authorName} `;
    input.dataset.parentId = parentId;
    input.focus();
    _autoResize(input);
    _updateCharCount(input);
}

function _getCurrentUsername() {
    try {
        const u = JSON.parse(localStorage.getItem('pageUser') || '{}');
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

    let modal = document.getElementById('pageShareModal');
    if (!modal) modal = _buildShareModal();

    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        modal.classList.add('modal--visible');
        modal.querySelector('.page-modal-box').classList.add('modal-box--visible');
    });

    _loadShareUrls(postId);
}

function closeShareModal() {
    const modal = document.getElementById('pageShareModal');
    if (!modal) return;
    modal.classList.remove('modal--visible');
    modal.querySelector('.page-modal-box').classList.remove('modal-box--visible');
    setTimeout(() => {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }, 280);
    _sharePostId = null;
    _shareUrls   = {};
}

function _buildShareModal() {
    const el = document.createElement('div');
    el.id        = 'pageShareModal';
    el.className = 'page-modal-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Share post');
    el.innerHTML = `
      <div class="page-modal-box page-modal-box--share" role="document">

        <div class="page-modal-head">
          <h3 class="page-modal-title"><i class="fas fa-share-alt"></i> Share Post</h3>
          <button class="page-modal-close" onclick="closeShareModal()" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <!-- Share platform grid -->
        <div class="page-share-grid">
          <button class="page-share-tile page-share-tile--fb"       onclick="_shareVia('facebook')">
            <i class="fab fa-facebook-f"></i><span>Facebook</span>
          </button>
          <button class="page-share-tile page-share-tile--wa"       onclick="_shareVia('whatsapp')">
            <i class="fab fa-whatsapp"></i><span>WhatsApp</span>
          </button>
          <button class="page-share-tile page-share-tile--x"        onclick="_shareVia('x')">
            <i class="fab fa-x-twitter"></i><span>X / Twitter</span>
          </button>
          <button class="page-share-tile page-share-tile--tg"       onclick="_shareVia('telegram')">
            <i class="fab fa-telegram-plane"></i><span>Telegram</span>
          </button>
          <button class="page-share-tile page-share-tile--copy"     onclick="_shareVia('copy_link')" id="pageCopyBtn">
            <i class="fas fa-link"></i><span>Copy Link</span>
          </button>
          <button class="page-share-tile page-share-tile--native"   onclick="_nativeShare()"
            id="pageNativeBtn" style="display:none">
            <i class="fas fa-share"></i><span>More…</span>
          </button>
        </div>

        <!-- URL bar -->
        <div class="page-share-url-bar">
          <input class="page-share-url-input" id="pageShareUrlInput" readonly value="Generating link…">
          <button class="page-share-url-copy" onclick="_copyFromInput()" aria-label="Copy link">
            <i class="fas fa-copy"></i>
          </button>
        </div>

        <!-- Share count feedback -->
        <p class="page-share-note" id="pageShareNote"></p>

      </div>`;

    el.addEventListener('click', e => { if (e.target === el) closeShareModal(); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') closeShareModal(); });

    // Show native share if available
    if (navigator.share) {
        const nb = el.querySelector('#pageNativeBtn');
        if (nb) nb.style.display = '';
    }

    document.body.appendChild(el);
    return el;
}

async function _loadShareUrls(postId) {
    const input = document.getElementById('pageShareUrlInput');
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
    const text = encodeURIComponent('Check out this post on PAGE! 🔥');
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

    window.open(url, `page-share-${platform}`, 'width=620,height=480,resizable=yes');
    await _recordShare(platform);
    socialToast(`Opening ${_platformLabel(platform)}…`, 'info');

    // Close after short delay so user sees the toast
    setTimeout(closeShareModal, 800);
}

async function _nativeShare() {
    const shareUrl = _shareUrls.copy_link || window.location.href;
    try {
        await navigator.share({ title: 'PAGE Post', text: 'Check out this post on PAGE! 🔥', url: shareUrl });
        await _recordShare('native');
        socialToast('Shared successfully! 🎉', 'success');
    } catch (e) {
        if (e.name !== 'AbortError') socialToast('Share cancelled.', 'info');
    }
}

async function _copyFromInput() {
    const input = document.getElementById('pageShareUrlInput');
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
    const btn = document.getElementById('pageCopyBtn');
    if (!btn) return;
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-check"></i><span>Copied!</span>';
    btn.classList.add('page-share-tile--copied');
    setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('page-share-tile--copied');
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
    const active = document.querySelector('.page-modal-overlay.modal--visible');
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
