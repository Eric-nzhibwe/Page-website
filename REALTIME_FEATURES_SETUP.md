# Real-Time Features Setup Guide

## Overview
This document explains how to set up and configure real-time features including:
- Live feed updates
- Real-time comments and shares
- Online user tracking
- Live notifications
- WebSocket connections

## Prerequisites

### 1. Install Django Channels
```bash
pip install channels channels-redis
```

### 2. Install Redis (for channel layer)
```bash
# On macOS
brew install redis

# On Ubuntu/Debian
sudo apt-get install redis-server

# On Windows (using WSL or Docker)
docker run -d -p 6379:6379 redis:latest
```

## Backend Setup

### 1. Update Django Settings

Add to `django_backend/artx_platform/settings.py`:

```python
# Add channels to INSTALLED_APPS
INSTALLED_APPS = [
    # ... existing apps ...
    'channels',
    'social',  # Make sure social app is included
]

# Configure Channels
ASGI_APPLICATION = 'artx_platform.asgi.application'

# Channel Layers Configuration
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [('127.0.0.1', 6379)],
            'capacity': 1500,
            'expiry': 10,
        },
    },
}

# For development without Redis (in-memory):
# CHANNEL_LAYERS = {
#     'default': {
#         'BACKEND': 'channels.layers.InMemoryChannelLayer'
#     }
# }
```

### 2. Create ASGI Application

Create `django_backend/artx_platform/asgi.py`:

```python
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from social.routing import websocket_urlpatterns

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

django_asgi_app = get_asgi_application()

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AuthMiddlewareStack(
        URLRouter(
            websocket_urlpatterns
        )
    ),
})
```

### 3. Update Main URLs

Add to `django_backend/artx_platform/urls.py`:

```python
from django.urls import path, include

urlpatterns = [
    # ... existing patterns ...
    path('api/social/', include('social.urls')),
]
```

### 4. Run Migrations

```bash
python manage.py makemigrations
python manage.py migrate
```

## Frontend Setup

### 1. Include Scripts and Styles

The following are already included in `index.html`:

```html
<link rel="stylesheet" href="styles/realtime-features.css">
<script src="scripts/realtime-updates.js"></script>
```

### 2. WebSocket Connection

The `RealtimeUpdates` class automatically:
- Connects to WebSocket endpoints
- Handles reconnection logic
- Manages online users list
- Displays real-time notifications

## Running the Application

### Development with Daphne

```bash
# Install Daphne
pip install daphne

# Run the server
daphne -b 0.0.0.0 -p 8000 artx_platform.asgi:application
```

### Production with Gunicorn + Daphne

```bash
# Install required packages
pip install gunicorn daphne

# Run with Gunicorn
gunicorn artx_platform.asgi:application \
    --workers 4 \
    --worker-class daphne.workers.UvicornWorker \
    --bind 0.0.0.0:8000
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM python:3.11

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "artx_platform.asgi:application"]
```

## Features

### 1. Real-Time Feed Updates

**What it does:**
- Automatically fetches new posts from followed users
- Updates post counts (reactions, comments, shares) in real-time
- Displays new posts at the top of the feed

**How it works:**
- WebSocket connection to `/ws/social/feed/`
- Receives `post_created`, `post_updated` events
- Updates UI without page refresh

### 2. Real-Time Comments

**What it does:**
- Shows new comments as they're posted
- Updates comment counts instantly
- Displays commenter information

**How it works:**
- `comment_created` event triggers UI update
- Comments appear in real-time on the post

### 3. Online Users Tracking

**What it does:**
- Shows list of currently online users
- Displays online indicator (green dot)
- Allows quick follow action

**How it works:**
- Receives `online_users` list on connection
- Updates when users come online/offline
- Shows user profile images and names

### 4. Real-Time Notifications

**What it does:**
- Notifies when someone follows you
- Alerts when someone comments on your post
- Shows general notifications

**How it works:**
- Separate WebSocket connection to `/ws/social/notifications/`
- Displays toast notifications
- Auto-dismisses after 5 seconds

### 5. Live Stories

**What it does:**
- Shows stories from followed users
- Updates story list in real-time
- Displays user profile images

**How it works:**
- Fetches stories on connection
- Updates when new stories are added
- Clickable story cards

## API Endpoints

### REST API

```
POST   /api/social/posts/                    # Create post
GET    /api/social/posts/                    # List posts
POST   /api/social/posts/{id}/react/         # React to post
POST   /api/social/posts/{id}/share/         # Share post
GET    /api/social/posts/{id}/share_urls/    # Get share URLs

POST   /api/social/comments/                 # Create comment
GET    /api/social/comments/                 # List comments
POST   /api/social/comments/{id}/react/      # React to comment
POST   /api/social/comments/{id}/reply/      # Reply to comment

POST   /api/social/follows/follow/           # Follow user
POST   /api/social/follows/unfollow/         # Unfollow user
GET    /api/social/follows/followers/        # Get followers
GET    /api/social/follows/following/        # Get following
GET    /api/social/follows/is_following/     # Check if following
```

### WebSocket Events

#### Feed Socket (`/ws/social/feed/`)

**Incoming:**
```json
{
  "type": "fetch_feed"
}
```

**Outgoing:**
```json
{
  "type": "feed_update",
  "posts": [...]
}

{
  "type": "post_created",
  "post": {...}
}

{
  "type": "online_users",
  "users": [...]
}
```

#### Notification Socket (`/ws/social/notifications/`)

**Outgoing:**
```json
{
  "type": "follow_notification",
  "follower_id": "...",
  "follower_name": "...",
  "follower_image": "..."
}

{
  "type": "comment_notification",
  "commenter_id": "...",
  "commenter_name": "...",
  "post_id": "...",
  "comment_preview": "..."
}
```

## Troubleshooting

### WebSocket Connection Issues

**Problem:** WebSocket connection fails
**Solution:**
1. Check Redis is running: `redis-cli ping`
2. Verify ASGI application is running
3. Check browser console for errors
4. Ensure WebSocket URL is correct (wss:// for HTTPS)

### No Real-Time Updates

**Problem:** Posts/comments not updating in real-time
**Solution:**
1. Check Django Channels is installed
2. Verify channel layer configuration
3. Check WebSocket connection in browser DevTools
4. Ensure users are authenticated

### High Memory Usage

**Problem:** Memory usage increases over time
**Solution:**
1. Configure channel layer expiry time
2. Limit number of online users tracked
3. Use Redis instead of in-memory layer
4. Monitor and clean up old connections

## Performance Optimization

### 1. Database Queries
- Use `select_related()` for foreign keys
- Use `prefetch_related()` for reverse relations
- Add database indexes on frequently queried fields

### 2. WebSocket Messages
- Limit message size
- Batch updates when possible
- Use compression for large payloads

### 3. Redis Configuration
```python
CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [('127.0.0.1', 6379)],
            'capacity': 1500,
            'expiry': 10,
            'group_expiry': 86400,
        },
    },
}
```

## Security Considerations

1. **Authentication:** All WebSocket connections require authentication
2. **Authorization:** Users can only see posts from followed users
3. **Rate Limiting:** Implement rate limiting on API endpoints
4. **Input Validation:** Validate all user inputs
5. **CORS:** Configure CORS properly for WebSocket connections

## Testing

### Test WebSocket Connection

```javascript
// In browser console
const ws = new WebSocket('ws://localhost:8000/ws/social/feed/');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));
ws.send(JSON.stringify({type: 'fetch_feed'}));
```

### Test API Endpoints

```bash
# Get auth token
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"user","password":"pass"}'

# Create post
curl -X POST http://localhost:8000/api/social/posts/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello world"}'
```

## Files Modified/Created

### Backend
- `django_backend/social/consumers.py` - WebSocket consumers
- `django_backend/social/routing.py` - WebSocket routing
- `django_backend/social/views.py` - API views
- `django_backend/social/urls.py` - API URLs
- `django_backend/artx_platform/asgi.py` - ASGI configuration

### Frontend
- `scripts/realtime-updates.js` - Real-time updates manager
- `scripts/social-features.js` - Comment and share modals
- `styles/realtime-features.css` - Real-time UI styles
- `styles/social-features.css` - Social features styles
- `index.html` - Updated with new sections

## Next Steps

1. Deploy Redis to production
2. Configure SSL/TLS for WebSocket (wss://)
3. Set up monitoring and logging
4. Implement rate limiting
5. Add more real-time features (typing indicators, read receipts, etc.)
