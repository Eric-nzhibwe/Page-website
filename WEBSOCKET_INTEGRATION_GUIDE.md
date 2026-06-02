# WebSocket Integration Guide for ARTX Platform

This guide explains how to integrate real-time WebSocket functionality into your ARTX frontend for comments, reactions, shares, and story viewing.

## Quick Start

### 1. Include the WebSocket Client

Add this script to your HTML (before your other scripts):

```html
<script src="scripts/websocket-client.js"></script>
```

### 2. Connect to Post WebSocket (for comments, reactions, shares)

```javascript
// Connect to a specific post
const postId = 'your-post-id';
const ws = wsClient.connectToPost(postId, {
    onConnect: () => {
        console.log('Connected to post WebSocket');
    },
    onComment: (comment) => {
        console.log('New comment received:', comment);
        // Update your UI with the new comment
        addCommentToUI(comment);
    },
    onReaction: (reaction) => {
        console.log('Reaction updated:', reaction);
        // Update your UI with the new reaction
        updateReactionCount(reaction);
    },
    onShare: (share) => {
        console.log('Post shared:', share);
        // Update your UI with the new share
        updateShareCount(share);
    },
    onError: (error) => {
        console.error('WebSocket error:', error);
    },
    onDisconnect: () => {
        console.log('Disconnected from post WebSocket');
    }
});
```

### 3. Connect to Stories WebSocket (for story viewing and creation)

```javascript
// Connect to stories feed
const ws = wsClient.connectToStories({
    onConnect: () => {
        console.log('Connected to stories WebSocket');
    },
    onView: (view, storyId) => {
        console.log('Story viewed:', view, 'for story:', storyId);
        // Update your UI with view count
        updateStoryViewCount(storyId, view);
    },
    onCreate: (story) => {
        console.log('New story created:', story);
        // Add new story to your UI
        addStoryToFeed(story);
    },
    onError: (error) => {
        console.error('WebSocket error:', error);
    },
    onDisconnect: () => {
        console.log('Disconnected from stories WebSocket');
    }
});
```

## Sending Messages

### Send a Comment

```javascript
// When user submits a comment
function submitComment(postId, content) {
    wsClient.sendComment(postId, content);
}
```

### Send a Reaction

```javascript
// When user reacts to a post
function reactToPost(postId, reactionType) {
    // reactionType can be: 'fire', 'like', 'love', 'wow', 'sad'
    wsClient.sendReaction(postId, reactionType);
}
```

### Send a Share

```javascript
// When user shares a post
function sharePost(postId, platform) {
    // platform can be: 'facebook', 'whatsapp', 'x', 'copy_link'
    wsClient.sendShare(postId, platform);
}
```

### Send Story View

```javascript
// When user views a story
function viewStory(storyId) {
    wsClient.sendStoryView(storyId);
}
```

### Create a Story

```javascript
// When user creates a story
function createStory(mediaUrl, mediaType, content) {
    wsClient.sendStoryCreate(mediaUrl, mediaType, content);
}
```

## Example Integration in Your HTML

Here's how to integrate this into your existing social feed:

```html
<!-- In your HTML file -->
<script src="scripts/websocket-client.js"></script>

<script>
// Global variable to store current post connection
let currentPostWs = null;

// Function to connect to a post when viewing it
function connectToPost(postId) {
    // Disconnect from previous post if any
    if (currentPostWs) {
        wsClient.disconnect(`post_${currentPostWs}`);
    }
    
    currentPostWs = postId;
    
    wsClient.connectToPost(postId, {
        onComment: (comment) => {
            // Add comment to the comments section
            const commentsContainer = document.getElementById(`comments-${postId}`);
            if (commentsContainer) {
                const commentElement = createCommentElement(comment);
                commentsContainer.appendChild(commentElement);
            }
        },
        onReaction: (reaction) => {
            // Update reaction count
            const reactionCount = document.getElementById(`reaction-count-${postId}`);
            if (reactionCount) {
                reactionCount.textContent = reaction.count || getReactionCount();
            }
        },
        onShare: (share) => {
            // Update share count
            const shareCount = document.getElementById(`share-count-${postId}`);
            if (shareCount) {
                shareCount.textContent = getShareCount();
            }
        }
    });
}

// Function to submit comment via WebSocket
function submitComment(postId) {
    const commentInput = document.getElementById(`comment-input-${postId}`);
    const content = commentInput.value.trim();
    
    if (content) {
        wsClient.sendComment(postId, content);
        commentInput.value = ''; // Clear input
    }
}

// Function to react to post via WebSocket
function reactToPost(postId, reactionType) {
    wsClient.sendReaction(postId, reactionType);
}

// Function to share post via WebSocket
function sharePost(postId, platform) {
    wsClient.sendShare(postId, platform);
}

// Connect to stories when page loads
document.addEventListener('DOMContentLoaded', () => {
    wsClient.connectToStories({
        onCreate: (story) => {
            // Add new story to feed
            const storiesContainer = document.getElementById('stories-feed');
            if (storiesContainer) {
                const storyElement = createStoryElement(story);
                storiesContainer.prepend(storyElement);
            }
        }
    });
});

// Clean up connections when leaving page
window.addEventListener('beforeunload', () => {
    wsClient.disconnectAll();
});
</script>
```

## Production Deployment

### 1. Update Environment Variables

Add these to your production environment (Render, Railway, etc.):

```bash
REDIS_URL=redis://your-redis-instance:6379/0
DEBUG=False
```

### 2. Use Daphne ASGI Server

Your production server should use Daphne instead of Gunicorn for WebSocket support:

**Procfile (for Render/Railway):**
```
web: daphne artx_platform.asgi:application --port $PORT --bind 0.0.0.0
```

**Or if using Gunicorn with Daphne workers:**
```
web: gunicorn artx_platform.wsgi:application --worker-class daphne.executors.workers.Worker --workers 4 --bind 0.0.0.0:$PORT
```

### 3. Configure Redis

For production, you need a Redis instance. Options:

- **Render Redis:** Add Redis addon to your Render app
- **Railway Redis:** Add Redis service to your Railway project
- **Redis Cloud:** Use Redis Cloud for managed Redis
- **Self-hosted:** Deploy Redis on your own server

Update your `.env` file:
```
REDIS_URL=redis://your-redis-host:6379/0
```

### 4. Update CORS Settings

Ensure your production domain is in `CORS_ALLOWED_ORIGINS`:

```python
# In settings.py
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='https://your-production-domain.com',
    cast=lambda v: [s.strip() for s in v.split(',')]
)
```

### 5. WebSocket URL Configuration

The WebSocket client automatically detects the protocol (ws:// or wss://) based on your page protocol. Ensure:

- Your site uses HTTPS in production (required for wss://)
- Your ASGI server is properly configured to handle WebSocket upgrades
- Your load balancer/proxy supports WebSocket connections

### 6. Testing WebSocket Connection

Test your WebSocket connection in production:

```javascript
// In browser console
const testWs = new WebSocket('wss://your-domain.com/ws/social/posts/test-post-id/');
testWs.onopen = () => console.log('WebSocket connected!');
testWs.onerror = (error) => console.error('WebSocket error:', error);
```

## Troubleshooting

### WebSocket Connection Fails

1. Check that your ASGI server is running with Daphne
2. Verify Redis is accessible and running
3. Check CORS settings allow your domain
4. Ensure your load balancer supports WebSocket connections
5. Check browser console for specific error messages

### Messages Not Received

1. Verify the WebSocket connection is established
2. Check that you're sending messages in the correct format
3. Ensure the consumer is properly handling the message type
4. Check Django logs for any errors

### Connection Drops Frequently

1. Check Redis connection stability
2. Increase WebSocket timeout settings if needed
3. Implement reconnection logic in your frontend
4. Check network stability and proxy settings

## Security Considerations

1. **Authentication:** WebSocket connections use Django's session authentication via `AuthMiddlewareStack`
2. **Authorization:** Each consumer checks `request.user.is_authenticated` before processing actions
3. **Rate Limiting:** Consider adding rate limiting to WebSocket connections
4. **Input Validation:** Always validate user input on both client and server side
5. **HTTPS:** Always use HTTPS in production (required for secure WebSocket connections)

## Performance Tips

1. **Connection Pooling:** Reuse WebSocket connections when possible
2. **Message Batching:** Batch multiple updates if sending many at once
3. **Lazy Loading:** Only connect to WebSockets when needed (e.g., when viewing a post)
4. **Cleanup:** Always disconnect WebSockets when leaving pages
5. **Redis Optimization:** Use Redis clustering for high-traffic scenarios
