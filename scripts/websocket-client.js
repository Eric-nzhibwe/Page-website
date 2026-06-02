/**
 * ARTX WebSocket Client
 * ─────────────────────
 * Manages three persistent WebSocket connections:
 *   1.  /ws/social/feed/         — live feed (posts, stories, activity ticker)
 *   2.  /ws/social/posts/<id>/   — per-post room (comments, reactions, shares)
 *   3.  /ws/social/stories/      — story viewer tracking
 *
 * Features
 * ─────────
 * • Token auth via ?token= query-param (DRF Token)
 * • Exponential-backoff auto-reconnect (max 8 attempts)
 * • Heartbeat ping every 25 s to keep connections alive through proxies
 * • Event-bus: any module can subscribe with  wsClient.on('feed', 'new_post', fn)
 * • Gracefully degrades — all API paths still work when WS is unavailable
 */

'use strict';

const _WS_HOST = window.location.host;
const _WS_PROTO = window.location.protocol === 'https:' ? 'wss' : 'ws';

function _wsUrl(path) {
    const token = localStorage.getItem('djangoAuthToken') || '';
    return `${_WS_PROTO}://${_WS_HOST}/ws/social/${path}?token=${encodeURIComponent(token)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Connection wrapper
// ─────────────────────────────────────────────────────────────────────────────
class _WSConn {
    constructor(name, urlFn, onMessage) {
        this.name        = name;
        this._urlFn      = urlFn;
        this._onMessage  = onMessage;
        this.ws          = null;
        this._attempt    = 0;
        this._maxAttempt = 8;
        this._baseDelay  = 1500;
        this._heartbeat  = null;
        this._dead       = false;   // permanently closed (page unload)
        this._open       = false;
    }

    connect() {
        if (this._dead) return;
        const url = this._urlFn();
        console.log(`[WS:${this.name}] connecting…`);
        try {
            this.ws = new WebSocket(url);
        } catch (e) {
            console.warn(`[WS:${this.name}] cannot open WebSocket:`, e.message);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log(`[WS:${this.name}] connected ✓`);
            this._attempt = 0;
            this._open    = true;
            this._startHeartbeat();
        };

        this.ws.onmessage = e => {
            try { this._onMessage(JSON.parse(e.data)); }
            catch (err) { console.warn(`[WS:${this.name}] parse error`, err); }
        };

        this.ws.onerror = () => {
            // onclose fires right after — handle there
        };

        this.ws.onclose = ev => {
            this._open = false;
            this._stopHeartbeat();
            if (this._dead) return;
            if (ev.code === 4001) {
                console.warn(`[WS:${this.name}] auth rejected — not reconnecting`);
                return;
            }
            console.log(`[WS:${this.name}] closed (${ev.code}) — will reconnect`);
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
            console.warn(`[WS:${this.name}] max reconnect attempts reached`);
            return;
        }
        const delay = this._baseDelay * Math.pow(1.6, this._attempt);
        this._attempt++;
        console.log(`[WS:${this.name}] reconnect in ${Math.round(delay)}ms (attempt ${this._attempt})`);
        setTimeout(() => this.connect(), delay);
    }

    _startHeartbeat() {
        this._heartbeat = setInterval(() => {
            this.send({ action: 'ping' });
        }, 25_000);
    }

    _stopHeartbeat() {
        clearInterval(this._heartbeat);
        this._heartbeat = null;
    }

    get isOpen() { return this._open; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ARTX WebSocket Client  (global singleton)
// ─────────────────────────────────────────────────────────────────────────────
class ARTXWebSocketClient {
    constructor() {
        this._listeners   = {};   // { 'channel:type': [fn, …] }
        this._feedConn    = null;
        this._storyConn   = null;
        this._postConns   = new Map();   // postId → _WSConn
    }

    // ── Event bus ─────────────────────────────────────────────────────────────
    /** Subscribe: wsClient.on('feed', 'new_post', fn) */
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
        // Also emit to wildcard  channel:*
        (this._listeners[`${channel}:*`] || []).forEach(fn => {
            try { fn({ type, ...data }); } catch (e) {}
        });
    }

    // ── Feed connection ────────────────────────────────────────────────────────
    connectFeed() {
        if (this._feedConn) return;
        this._feedConn = new _WSConn(
            'feed',
            () => _wsUrl('feed/'),
            msg => this._handleFeed(msg)
        );
        this._feedConn.connect();
    }

    _handleFeed(msg) {
        switch (msg.type) {
            case 'feed_snapshot':   this._emit('feed', 'snapshot',      { posts:   msg.posts   }); break;
            case 'new_post':        this._emit('feed', 'new_post',      { post:    msg.post    }); break;
            case 'post_update':     this._emit('feed', 'post_update',   msg);                       break;
            case 'live_activity':   this._emit('feed', 'live_activity', msg);                       break;
            case 'new_story':       this._emit('feed', 'new_story',     { story:   msg.story   }); break;
            default: break;
        }
    }

    // ── Per-post connection ────────────────────────────────────────────────────
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
            case 'comments_snapshot':
                this._emit('post', 'comments_snapshot', { postId, comments: msg.comments });
                callbacks.onSnapshot?.(msg.comments);
                break;
            case 'comment_created':
                this._emit('post', 'comment_created',  { postId, comment: msg.comment });
                callbacks.onComment?.(msg.comment);
                break;
            case 'reaction_updated':
                this._emit('post', 'reaction_updated', { postId, reaction: msg.reaction });
                callbacks.onReaction?.(msg.reaction);
                break;
            case 'post_shared':
                this._emit('post', 'post_shared',      { postId, share: msg.share });
                callbacks.onShare?.(msg.share);
                break;
            default: break;
        }
    }

    sendComment(postId, content, parentId = null) {
        const conn = this._postConns.get(String(postId));
        return conn?.send({ action: 'comment', content, parent_id: parentId }) || false;
    }

    sendReaction(postId, reactionType = 'fire') {
        const conn = this._postConns.get(String(postId));
        return conn?.send({ action: 'react', reaction_type: reactionType }) || false;
    }

    sendShare(postId, platform) {
        const conn = this._postConns.get(String(postId));
        return conn?.send({ action: 'share', platform }) || false;
    }

    // ── Story connection ───────────────────────────────────────────────────────
    connectToStories(callbacks = {}) {
        if (this._storyConn) return;
        this._storyConn = new _WSConn(
            'stories',
            () => _wsUrl('stories/'),
            msg => this._handleStory(msg, callbacks)
        );
        this._storyConn.connect();
    }

    _handleStory(msg, callbacks) {
        switch (msg.type) {
            case 'stories_snapshot':
                this._emit('stories', 'snapshot',      { stories: msg.stories });
                callbacks.onSnapshot?.(msg.stories);
                break;
            case 'story_viewed':
                this._emit('stories', 'story_viewed',  { view: msg.view, storyId: msg.story_id });
                callbacks.onView?.(msg.view, msg.story_id);
                break;
            case 'story_created':
                this._emit('stories', 'story_created', { story: msg.story });
                callbacks.onCreate?.(msg.story);
                break;
            default: break;
        }
    }

    sendStoryView(storyId) {
        this._storyConn?.send({ action: 'view', story_id: storyId });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    disconnect(key) {
        if (key === 'feed')    { this._feedConn?.close();  this._feedConn  = null; }
        if (key === 'stories') { this._storyConn?.close(); this._storyConn = null; }
        // post connections by postId
        if (this._postConns.has(key)) { this._postConns.get(key).close(); this._postConns.delete(key); }
    }

    disconnectAll() {
        this._feedConn?.close();
        this._storyConn?.close();
        this._postConns.forEach(c => c.close());
        this._feedConn = this._storyConn = null;
        this._postConns.clear();
    }

    get feedConnected()   { return this._feedConn?.isOpen  || false; }
    get storyConnected()  { return this._storyConn?.isOpen || false; }
}

// ─── Global singleton ─────────────────────────────────────────────────────────
const wsClient = new ARTXWebSocketClient();
window.wsClient = wsClient;

window.addEventListener('beforeunload', () => wsClient.disconnectAll());
