/**
 * PAGE Story Viewer
 * – Instagram-style full-screen modal
 * – Per-story progress segments with auto-advance
 * – React, Reply-to-inbox, Share buttons
 * – Multiple stories per user, grouped by author
 */

class StoryViewer {
    constructor() {
        this.stories          = [];     // flat array of stories currently open
        this.currentIndex     = 0;
        this.autoPlayTimer    = null;
        this.segmentTimer     = null;
        this.storyPollInterval = null;
        this.isPaused         = false;
        this.segmentDuration  = 6000;  // ms per story
        this.segmentStart     = null;
        this.viewers          = new Map();
    }

    // ── Public API ──────────────────────────────────────────────────
    openStory(storyId, stories = []) {
        this.stories      = stories;
        this.currentIndex = Math.max(0, stories.findIndex(s => s.id === storyId));
        this._render();
        this._show();
        this._markViewed(stories[this.currentIndex]?.id);
    }

    closeStory() {
        const modal = document.getElementById('storyViewerModal');
        if (!modal) return;
        modal.classList.remove('story-modal--visible');
        setTimeout(() => { modal.style.display = 'none'; }, 220);
        this._clearTimers();
        if (this.storyPollInterval) { clearInterval(this.storyPollInterval); this.storyPollInterval = null; }
        this.stories = [];
        this.currentIndex = 0;
    }

    nextStory() {
        if (this.currentIndex < this.stories.length - 1) {
            this.currentIndex++;
            this._render();
            this._markViewed(this.stories[this.currentIndex]?.id);
        } else {
            this.closeStory();
        }
    }

    previousStory() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this._render();
        }
    }

    // ── Rendering ───────────────────────────────────────────────────
    _render() {
        const modal = this._getOrCreate();
        const story = this.stories[this.currentIndex];
        if (!story) { this.closeStory(); return; }

        // ── Segments ──
        const segWrap = modal.querySelector('.story-segments');
        segWrap.innerHTML = this.stories.map((s, i) => `
            <div class="story-segment ${i < this.currentIndex ? 'done' : ''}">
                <div class="story-segment-fill" style="width:${i < this.currentIndex ? '100' : '0'}%"></div>
            </div>`).join('');

        // ── Author header ──
        // Prefer profile_image_url (avatar_url/base64) over legacy profile_image
        const _authorAvatarUrl = (story.author?.profile_image_url || story.author?.avatar_url)
            || (story.author?.profile_image && !story.author.profile_image.startsWith('/media/')
                ? story.author.profile_image : null);
        const avHTML = _authorAvatarUrl
            ? `<img src="${this._esc(_authorAvatarUrl)}" alt="${this._esc(story.author?.username || 'User')}"
                   onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\\'fas fa-user-circle\\'></i>'">`
            : `<i class="fas fa-user-circle"></i>`;

        modal.querySelector('.story-author-avatar').innerHTML = avHTML;
        modal.querySelector('.story-author-name').textContent = story.author?.display_name || story.author?.username || 'User';
        modal.querySelector('.story-time-label').textContent  = this._timeAgo(story.created_at);

        // Story count badge
        const badge = modal.querySelector('.story-header-count');
        if (this.stories.length > 1) {
            badge.textContent = `${this.currentIndex + 1}/${this.stories.length}`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }

        // ── Media ──
        const mediaSrc  = story.resolved_media_url || story.media_url || '';
        const mediaWrap = modal.querySelector('.story-media-container');
        if (story.media_type === 'video' && mediaSrc) {
            mediaWrap.innerHTML = `<video class="story-media" autoplay muted playsinline loop src="${this._esc(mediaSrc)}"></video>`;
        } else if (mediaSrc) {
            mediaWrap.innerHTML = `<img class="story-media" src="${this._esc(mediaSrc)}" alt="Story">`;
        } else {
            mediaWrap.innerHTML = `<div style="width:100%;height:100%;background:linear-gradient(135deg,var(--page-primary),var(--page-accent));display:flex;align-items:center;justify-content:center;"><i class="fas fa-image" style="font-size:48px;color:rgba(255,255,255,.5);"></i></div>`;
        }

        // ── Text overlay ──
        let overlay = modal.querySelector('.story-text-overlay');
        if (story.content) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'story-text-overlay';
                mediaWrap.appendChild(overlay);
            }
            overlay.textContent = story.content;
            overlay.style.display = '';
        } else {
            if (overlay) overlay.style.display = 'none';
        }

        // ── Start auto-advance ──
        this._startSegment();
    }

    _show() {
        const modal = document.getElementById('storyViewerModal');
        modal.style.display = 'flex';
        requestAnimationFrame(() => modal.classList.add('story-modal--visible'));
    }

    _getOrCreate() {
        let modal = document.getElementById('storyViewerModal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'storyViewerModal';
        modal.className = 'modal-overlay story-modal-overlay';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="story-viewer-container">
                <div class="story-viewer-main">

                    <!-- Progress segments -->
                    <div class="story-segments"></div>

                    <!-- Header -->
                    <div class="story-viewer-header">
                        <div class="story-author-info">
                            <div class="story-author-avatar"></div>
                            <div class="story-author-details">
                                <h3 class="story-author-name"></h3>
                                <p class="story-time story-time-label"></p>
                            </div>
                        </div>
                        <div class="story-header-right">
                            <span class="story-header-count" style="
                                display:none;
                                background:rgba(255,255,255,0.2);
                                color:#fff;
                                font-size:11px;
                                font-weight:700;
                                padding:3px 9px;
                                border-radius:20px;
                                align-items:center;
                                justify-content:center;
                            "></span>
                        </div>
                    </div>

                    <!-- Close button -->
                    <button class="story-close-btn" onclick="storyViewer.closeStory()" aria-label="Close story">
                        <i class="fas fa-times"></i>
                    </button>

                    <!-- Media -->
                    <div class="story-viewer-content">
                        <div class="story-media-container"></div>
                    </div>

                    <!-- Tap zones -->
                    <button class="story-nav-btn story-prev-btn" onclick="storyViewer.previousStory()" aria-label="Previous story">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="story-nav-btn story-next-btn" onclick="storyViewer.nextStory()" aria-label="Next story">
                        <i class="fas fa-chevron-right"></i>
                    </button>

                    <!-- Action bar -->
                    <div class="story-action-bar">
                        <input class="story-reply-input" type="text" placeholder="Reply to story…" id="storyReplyInput">
                        <button class="story-action-btn" id="storyReactBtn" title="React" onclick="storyViewer._handleReact()">
                            <i class="fas fa-heart"></i>
                        </button>
                        <button class="story-action-btn" title="Send reply" onclick="storyViewer._handleReply()">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                        <button class="story-action-btn" title="Share story" onclick="storyViewer._handleShare()">
                            <i class="fas fa-share"></i>
                        </button>
                    </div>
                </div>

                <!-- Viewers sidebar (desktop) -->
                <div class="story-viewers-sidebar">
                    <div class="viewers-header">
                        <h3>Viewers</h3>
                        <span class="viewer-count" id="viewerCount">0</span>
                    </div>
                    <div class="viewers-list" id="viewersList">
                        <p class="loading">Loading…</p>
                    </div>
                </div>
            </div>`;

        document.body.appendChild(modal);

        // Pause on press-hold
        const main = modal.querySelector('.story-viewer-main');
        main.addEventListener('mousedown', () => this._pause());
        main.addEventListener('mouseup',   () => this._resume());
        main.addEventListener('touchstart', () => this._pause(), { passive: true });
        main.addEventListener('touchend',   () => this._resume(), { passive: true });

        // Close on backdrop
        modal.addEventListener('click', e => { if (e.target === modal) this.closeStory(); });

        // Keyboard
        document.addEventListener('keydown', e => {
            if (modal.style.display !== 'flex') return;
            if (e.key === 'ArrowRight') this.nextStory();
            if (e.key === 'ArrowLeft')  this.previousStory();
            if (e.key === 'Escape')     this.closeStory();
        });

        return modal;
    }

    // ── Segment auto-advance ────────────────────────────────────────
    _startSegment() {
        this._clearTimers();
        this.segmentStart = Date.now();
        this.isPaused     = false;

        const segments = document.querySelectorAll('.story-segment');
        const fill     = segments[this.currentIndex]?.querySelector('.story-segment-fill');
        if (!fill) return;

        const duration = this.segmentDuration;
        const tick = () => {
            if (this.isPaused) return;
            const elapsed  = Date.now() - this.segmentStart;
            const pct      = Math.min((elapsed / duration) * 100, 100);
            fill.style.width = pct + '%';
            if (pct < 100) {
                this.segmentTimer = requestAnimationFrame(tick);
            } else {
                this.nextStory();
            }
        };
        this.segmentTimer = requestAnimationFrame(tick);
    }

    _pause() {
        this.isPaused = true;
        this._pausedAt = Date.now();
    }

    _resume() {
        if (!this.isPaused) return;
        const paused = Date.now() - (this._pausedAt || Date.now());
        this.segmentStart += paused;
        this.isPaused = false;
        this._startSegment();
    }

    _clearTimers() {
        if (this.segmentTimer)  { cancelAnimationFrame(this.segmentTimer); this.segmentTimer = null; }
        if (this.autoPlayTimer) { clearTimeout(this.autoPlayTimer); this.autoPlayTimer = null; }
    }

    // ── Interactions ────────────────────────────────────────────────
    async _handleReact() {
        const story = this.stories[this.currentIndex];
        if (!story) return;
        const btn   = document.getElementById('storyReactBtn');
        btn?.classList.toggle('reacted');
        const liked = btn?.classList.contains('reacted');
        // Send a DM to the story author with a heart reaction
        await this._sendInboxMessage(story, liked ? '❤️ Reacted to your story' : null);
        if (typeof socialToast === 'function') {
            socialToast(liked ? '❤️ Reaction sent!' : 'Reaction removed', 'info');
        }
    }

    async _handleReply() {
        const input = document.getElementById('storyReplyInput');
        const msg   = input?.value?.trim();
        if (!msg) { input?.focus(); return; }
        const story = this.stories[this.currentIndex];
        if (!story) return;

        const sent = await this._sendInboxMessage(story, msg);
        if (sent) {
            input.value = '';
            if (typeof socialToast === 'function') socialToast('Reply sent to their inbox 📨', 'success');
        } else {
            if (typeof socialToast === 'function') socialToast('Could not send reply', 'error');
        }
    }

    async _sendInboxMessage(story, message) {
        if (!message) return false;
        const token = localStorage.getItem('djangoAuthToken');
        if (!token) return false;

        const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:8000/api'
            : `${location.origin}/api`;

        try {
            // Find or create a conversation with the story author, then send the message
            const convRes = await fetch(`${API}/messenger/conversations/`, {
                method:  'POST',
                headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ recipient_id: story.author?.id }),
            });
            if (!convRes.ok) return false;
            const conv = await convRes.json();
            const convId = conv.id || conv.conversation_id;

            const prefix = `💬 Story reply: `;
            const msgRes = await fetch(`${API}/messenger/conversations/${convId}/messages/`, {
                method:  'POST',
                headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
                body:    JSON.stringify({ text: prefix + message }),
            });
            return msgRes.ok;
        } catch {
            return false;
        }
    }

    _handleShare() {
        const story = this.stories[this.currentIndex];
        if (!story) return;
        const url   = `${location.origin}/story/${story.id}`;
        const text  = `Check out this story on PAGE!`;
        if (navigator.share) {
            navigator.share({ title: 'PAGE Story', text, url }).catch(() => {});
        } else {
            navigator.clipboard?.writeText(url)
                .then(() => { if (typeof socialToast === 'function') socialToast('Story link copied! 🔗', 'success'); })
                .catch(() => {});
        }
    }

    // ── Mark viewed ─────────────────────────────────────────────────
    async _markViewed(storyId) {
        if (!storyId) return;
        const token = localStorage.getItem('djangoAuthToken');
        if (!token) return;
        const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'http://localhost:8000/api' : `${location.origin}/api`;
        try {
            await fetch(`${API}/social/stories/${storyId}/view/`, {
                method: 'POST',
                headers: { 'Authorization': `Token ${token}`, 'Content-Type': 'application/json' },
            });
        } catch { /* silent */ }
    }

    // ── Utilities ───────────────────────────────────────────────────
    _timeAgo(iso) {
        if (!iso) return '';
        const s = Math.floor((Date.now() - new Date(iso)) / 1000);
        if (s < 60)  return 'Just now';
        const m = Math.floor(s / 60); if (m < 60)  return `${m}m`;
        const h = Math.floor(m / 60); if (h < 24)  return `${h}h`;
        return new Date(iso).toLocaleDateString();
    }

    _esc(s) {
        const d = document.createElement('div');
        d.textContent = String(s ?? '');
        return d.innerHTML;
    }

    // ── Backward compat aliases ──────────────────────────────────────
    formatTimeAgo(iso)  { return this._timeAgo(iso); }
    escapeHtml(s)       { return this._esc(s); }
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
let storyViewer;
document.addEventListener('DOMContentLoaded', () => {
    storyViewer = new StoryViewer();
    window.storyViewer = storyViewer;
});
window.addEventListener('beforeunload', () => storyViewer?.closeStory());
