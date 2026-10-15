/**
 * PAGE WebSocket Client
 * ─────────────────────
 * Manages four persistent WebSocket connections:
 *   1.  /ws/social/feed/         — live feed (posts, stories, activity ticker)
 *   2.  /ws/social/posts/<id>/   — per-post room (comments, reactions, shares)
 *   3.  /ws/social/stories/      — story viewer tracking
 *   4.  /ws/social/user-feed/    — follower-scoped updates (new posts/stories)
 *
 * Features
 * ─────────
 * • Probes /api/ws-status/ before opening any connection — if Redis is not
 *   configured, all WS attempts are skipped silently.
 * • Token auth via ?token= query-param (DRF Token)
 * • Exponential-backoff auto-reconnect (max 5 attempts, then permanent stop)
 * • Heartbeat ping every 25 s to keep connections alive through proxies
 * • Event-bus: wsClient.on('feed', 'new_post', fn)
 * • Gracefully degrades — all API paths still work when WS is unavailable
 */

'use strict';

const _WS_HOST = window.location.host;
const _WS_PROTO = window.location.protocol === 'https:' ? 'wss' : 'ws';

function _wsUrl(path) {
    const token = localStorage.getItem('djangoAuthToken') || '';
    return `${_WS_PROTO}://${_WS_HOST}/ws/social/${path}?token=${encodeURIComponent(token)}`;
}

// ─── One-time WS support probe ────────────────────────────────────────────────
let _wsClientSupported = null;

async function _wsClientCheckSupport() {
    if (_wsClientSupported !== null) return _wsClientSupported;
    const cached = sessionStorage.getItem('ws_supported');
    if (cached !== null) {
        _wsClientSupported = cached === 'true';
        return _wsClientSupported;
    }
    try {
        const r = await fetch('/api/ws-status/');
        const d = await r.json();
        _wsClientSupported = !!d.ws_supported;
    } catch (_) {
        _wsClientSupported = false;
    }
    sessionStorage.setItem('ws_supported', String(_wsClientSupported));
    console.info(`[PAGE WS] ${_wsClientSupported ? 'Redis active — real-time enabled' : 'No Redis — WebSockets disabled'}`);
    return _wsClientSupported;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Connection wrapper
// ─────────────────────────────────────────────────────────────────────────────
class _WSConn {
    constructor(name, urlFn, onMessage) {
        this.name = name;
        this._urlFn = urlFn;
        this._onMessage = onMessage;
        this.ws = null;
        this._attempt = 0;
        this._maxAttempt = 5;
        this._baseDelay = 2000;
        this._heartbeat = null;
        this._dead = false;
        this._open = false;
        this._disabled = false;
    }

    async connect() {
        if (this._dead || this._disabled) return;

        const supported = await _wsClientCheckSupport();
        if (!supported) {
            this._disabled = true;
            return;
        }

        const url = this._urlFn();
        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this._attempt = 0;
            this._open = true;
            this._startHeartbeat();
            console.log(`[WS:${this.name}] connected`);
        };

        this.ws.onmessage = e => {
            try { this._onMessage(JSON.parse(e.data)); }
            catch (_) { /* ignore parse errors */ }
        };

        this.ws.onerror = () => { /* onclose handles it */ };

        this.ws.onclose = ev => {
            this._open = false;
            this._stopHeartbeat();
            if (this._dead || this._disabled) return;
            if (ev.code === 4001) return;   // auth rejected
            if (ev.code === 1006 && this._attempt === 0) {
                // Immediate refusal — no Redis
                this._disabled = true;
                sessionStorage.setItem('ws_supported', 'false');
                _wsClientSupported = false;
                return;
            }
            this._scheduleReconnect();
        };
    }

    send(payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
            return true;
        }
        return false;
    }

    close() {
        this._dead = true;
        this._stopHeartbeat();
        this.ws?.close();
    }

    _scheduleReconnect() {
        if (this._attempt >= this._maxAttempt) {
            this._disabled = true;
            return;
        }
        const delay = Math.min(this._baseDelay * Math.pow(2, this._attempt), 30_000);
        this._attempt++;
        setTimeout(() => this.connect(), delay);
    }

    _startHeartbeat() {
        this._heartbeat = setInterval(() => this.send({ action: 'ping' }), 25_000);
    }

    _stopHeartbeat() {
        clearInterval(this._heartbeat);
        this._heartbeat = null;
    }

    get isOpen() { return this._open; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PAGE WebSocket Client  (global singleton)
// ─────────────────────────────────────────────────────────────────────────────
class PAGEWebSocketClient {
    constructor() {
        this._listeners = {};
        this._feedConn = null;
        this._storyConn = null;
        this._userFeedConn = null;
        this._messengerConn = null;
        this._postConns = new Map();
    }

    // ── Event bus ─────────────────────────────────────────────────────────────
    on(channel, type, fn) {
        const key = `${channel}:${type}`;
        (this._listeners[key] = this._listeners[key] || []).push(fn);
    }

    off(channel, type, fn) {
        const key = `${channel}:${type}`;
        this._listeners[key] = (this._listeners[key] || []).filter(f => f !== fn);
    }

    _emit(channel, type, data) {
        const key = `${channel}:${type}`;
        (this._listeners[key] || []).forEach(fn => {
            try { fn(data); } catch (e) { console.error('[WS emit]', e); }
        });
        (this._listeners[`${channel}:*`] || []).forEach(fn => {
            try { fn({ type, ...data }); } catch (_) { }
        });
    }

    // ── Feed (global posts + story broadcasts) ────────────────────────────────
    connectFeed() {
        if (this._feedConn) return;
        this._feedConn = new _WSConn('feed', () => _wsUrl('feed/'), msg => this._handleFeed(msg));
        this._feedConn.connect();
    }

    _handleFeed(msg) {
        switch (msg.type) {
            case 'feed_snapshot': this._emit('feed', 'snapshot', { posts: msg.posts }); break;
            case 'new_post': this._emit('feed', 'new_post', { post: msg.post }); break;
            case 'post_update': this._emit('feed', 'post_update', msg); break;
            case 'live_activity': this._emit('feed', 'live_activity', msg); break;
            case 'new_story': this._emit('feed', 'new_story', { story: msg.story }); break;
        }
    }

    // ── Per-post room (comments / reactions / shares) ─────────────────────────
    connectToPost(postId, callbacks = {}) {
        const key = String(postId);
        if (this._postConns.has(key)) return;
        const conn = new _WSConn(
            `post:${key.slice(0, 8)}`,
            () => _wsUrl(`posts/${key}/`),
            msg => this._handlePost(key, msg, callbacks)
        );
        this._postConns.set(key, conn);
        conn.connect();
    }

    disconnectPost(postId) {
        const key = String(postId);
        this._postConns.get(key)?.close();
        this._postConns.delete(key);
    }

    _handlePost(postId, msg, callbacks) {
        switch (msg.type) {
            case 'comments_snapshot': this._emit('post', 'comments_snapshot', { postId, comments: msg.comments }); callbacks.onSnapshot?.(msg.comments); break;
            case 'comment_created': this._emit('post', 'comment_created', { postId, comment: msg.comment }); callbacks.onComment?.(msg.comment); break;
            case 'reaction_updated': this._emit('post', 'reaction_updated', { postId, reaction: msg.reaction }); callbacks.onReaction?.(msg.reaction); break;
            case 'post_shared': this._emit('post', 'post_shared', { postId, share: msg.share }); callbacks.onShare?.(msg.share); break;
        }
    }

    sendComment(postId, content, parentId = null) {
        return this._postConns.get(String(postId))?.send({ action: 'comment', content, parent_id: parentId }) || false;
    }

    sendReaction(postId, reactionType = 'fire') {
        return this._postConns.get(String(postId))?.send({ action: 'react', reaction_type: reactionType }) || false;
    }

    sendShare(postId, platform) {
        return this._postConns.get(String(postId))?.send({ action: 'share', platform }) || false;
    }

    // ── Stories ───────────────────────────────────────────────────────────────
    connectToStories(callbacks = {}) {
        if (this._storyConn) return;
        this._storyConn = new _WSConn('stories', () => _wsUrl('stories/'), msg => this._handleStory(msg, callbacks));
        this._storyConn.connect();
    }

    _handleStory(msg, callbacks) {
        switch (msg.type) {
            case 'stories_snapshot': this._emit('stories', 'snapshot', { stories: msg.stories }); callbacks.onSnapshot?.(msg.stories); break;
            case 'story_viewed': this._emit('stories', 'story_viewed', { view: msg.view, storyId: msg.story_id }); callbacks.onView?.(msg.view, msg.story_id); break;
            case 'story_created': this._emit('stories', 'story_created', { story: msg.story }); callbacks.onCreate?.(msg.story); break;
        }
    }

    sendStoryView(storyId) {
        this._storyConn?.send({ action: 'view', story_id: storyId });
    }

    // ── User-feed (follower-scoped: new posts/stories from followed users) ─────
    connectUserFeed(callbacks = {}) {
        if (this._userFeedConn) return;
        this._userFeedConn = new _WSConn('user-feed', () => _wsUrl('user-feed/'), msg => this._handleUserFeed(msg, callbacks));
        this._userFeedConn.connect();
    }

    _handleUserFeed(msg, callbacks) {
        switch (msg.type) {
            case 'user_feed_ready': this._emit('userFeed', 'ready', {}); callbacks.onReady?.(); break;
            case 'followed_new_post': this._emit('userFeed', 'new_post', { post: msg.post }); callbacks.onNewPost?.(msg.post); break;
            case 'followed_new_story': this._emit('userFeed', 'new_story', { story: msg.story }); callbacks.onNewStory?.(msg.story); break;
            case 'followed_avatar_updated': this._emit('userFeed', 'avatar_updated', msg); callbacks.onAvatarUpdated?.(msg); break;
        }
    }

    // ── Messenger ─────────────────────────────────────────────────────────────
    connectMessenger(callbacks = {}) {
        if (this._messengerConn) return;
        this._messengerConn = new _WSConn(
            'messenger',
            () => {
                const token = localStorage.getItem('djangoAuthToken') || '';
                return `${_WS_PROTO}://${_WS_HOST}/ws/messenger/?token=${encodeURIComponent(token)}`;
            },
            msg => this._handleMessenger(msg, callbacks)
        );
        this._messengerConn.connect();
    }

    _handleMessenger(msg, callbacks) {
        switch (msg.type) {
            case 'messenger_ready':
                this._emit('messenger', 'ready', { unreadCount: msg.unread_count });
                callbacks.onReady?.(msg.unread_count);
                break;
            case 'new_message':
                this._emit('messenger', 'new_message', { message: msg.message });
                callbacks.onMessage?.(msg.message);
                break;
            case 'typing':
                this._emit('messenger', 'typing', msg);
                callbacks.onTyping?.(msg);
                break;
            case 'marked_read':
                this._emit('messenger', 'marked_read', msg);
                callbacks.onMarkedRead?.(msg);
                break;
        }
    }

    sendTyping(conversationId, isTyping) {
        this._messengerConn?.send({
            action: 'typing',
            conversation_id: conversationId,
            is_typing: isTyping,
        });
    }

    sendMarkRead(conversationId) {
        this._messengerConn?.send({ action: 'mark_read', conversation_id: conversationId });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    disconnect(key) {
        if (key === 'feed') { this._feedConn?.close(); this._feedConn = null; }
        if (key === 'stories') { this._storyConn?.close(); this._storyConn = null; }
        if (key === 'user-feed') { this._userFeedConn?.close(); this._userFeedConn = null; }
        if (key === 'messenger') { this._messengerConn?.close(); this._messengerConn = null; }
        if (this._postConns.has(key)) { this._postConns.get(key).close(); this._postConns.delete(key); }
    }

    disconnectAll() {
        this._feedConn?.close();
        this._storyConn?.close();
        this._userFeedConn?.close();
        this._messengerConn?.close();
        this._postConns.forEach(c => c.close());
        this._feedConn = this._storyConn = this._userFeedConn = this._messengerConn = null;
        this._postConns.clear();
    }

    get feedConnected() { return this._feedConn?.isOpen || false; }
    get storyConnected() { return this._storyConn?.isOpen || false; }
    get userFeedConnected() { return this._userFeedConn?.isOpen || false; }
    get messengerConnected() { return this._messengerConn?.isOpen || false; }
}

const wsClient = new PAGEWebSocketClient();
window.wsClient = wsClient;

window.addEventListener('beforeunload', () => wsClient.disconnectAll());
