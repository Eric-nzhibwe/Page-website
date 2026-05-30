# Real-Time Features - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Install Dependencies (1 min)
```bash
cd django_backend
pip install channels channels-redis
```

### Step 2: Install Redis (1 min)
```bash
# macOS
brew install redis

# Ubuntu/Debian
sudo apt-get install redis-server

# Docker (easiest)
docker run -d -p 6379:6379 redis:latest
```

### Step 3: Update Django Settings (1 min)

Add to `django_backend/artx_platform/settings.py`:

```python
# Add to INSTALLED_APPS
INSTALLED_APPS = [
    # ... existing apps ...
    'channels',
    'social',
]

# Add at the end
ASGI_APPLICATION = 'artx_platform.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        'CONFIG': {
            'hosts': [('127.0.0.1', 6379)],
        },
    },
}
```

### Step 4: Run Migrations (1 min)
```bash
python manage.py migrate
```

### Step 5: Start Services (1 min)

**Terminal 1 - Redis:**
```bash
redis-server
```

**Terminal 2 - Django:**
```bash
cd django_backend
daphne -b 0.0.0.0 -p 8000 artx_platform.asgi:application
```

**Terminal 3 - Frontend (optional):**
```bash
# If using a dev server
npm run dev
```

## ✅ Verify It's Working

### Check Redis
```bash
redis-cli ping
# Should return: PONG
```

### Check WebSocket Connection
Open browser console and run:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/social/feed/');
ws.onopen = () => console.log('✅ Connected!');
ws.onerror = (e) => console.log('❌ Error:', e);
```

### Check Online Users
1. Open http://localhost:8000
2. Look at right sidebar
3. Should see "Online Now" section with users

## 🎯 What You Can Do Now

### 1. **View Live Feed**
- Posts update automatically
- No page refresh needed
- See new posts instantly

### 2. **Comment in Real-Time**
- Click comment button
- Type your comment
- Post appears instantly
- Others see it immediately

### 3. **Share Posts**
- Click share button
- Choose platform (Facebook, WhatsApp, X)
- Or copy link
- Share count updates live

### 4. **See Online Users**
- Check right sidebar
- See who's online
- Green indicator shows active users
- Click to follow

### 5. **Get Notifications**
- Toast notifications appear
- Follow alerts
- Comment alerts
- Auto-dismiss after 5 seconds

## 📱 Test on Mobile

1. Get your computer's IP: `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux)
2. Open on phone: `http://YOUR_IP:8000`
3. See real-time updates on mobile

## 🔧 Common Issues & Fixes

### Issue: WebSocket connection fails
```
❌ WebSocket is closed before the connection is established
```
**Fix:** Make sure Redis is running
```bash
redis-cli ping  # Should return PONG
```

### Issue: "channels not installed"
```
❌ ModuleNotFoundError: No module named 'channels'
```
**Fix:** Install channels
```bash
pip install channels channels-redis
```

### Issue: "No module named 'social'"
```
❌ ModuleNotFoundError: No module named 'social'
```
**Fix:** Make sure 'social' is in INSTALLED_APPS in settings.py

### Issue: Port 8000 already in use
```
❌ Address already in use
```
**Fix:** Use different port
```bash
daphne -b 0.0.0.0 -p 8001 artx_platform.asgi:application
```

## 📊 Monitor Real-Time Activity

### View Redis Stats
```bash
redis-cli info stats
```

### View Active Connections
```bash
redis-cli client list
```

### View Channel Messages
```bash
redis-cli subscribe social_feed_*
```

## 🚀 Deploy to Production

### Using Gunicorn + Daphne
```bash
pip install gunicorn daphne

gunicorn artx_platform.asgi:application \
    --workers 4 \
    --worker-class daphne.workers.UvicornWorker \
    --bind 0.0.0.0:8000
```

### Using Docker
```bash
docker build -t artx-realtime .
docker run -p 8000:8000 -e REDIS_URL=redis://redis:6379 artx-realtime
```

### Using Heroku
```bash
# Add Procfile
echo "web: daphne -b 0.0.0.0 -p \$PORT artx_platform.asgi:application" > Procfile

# Deploy
git push heroku main
```

## 📚 Learn More

- **Full Setup Guide:** `REALTIME_FEATURES_SETUP.md`
- **Implementation Details:** `REALTIME_IMPLEMENTATION_SUMMARY.md`
- **API Documentation:** See REST endpoints in setup guide
- **WebSocket Events:** See event types in setup guide

## 🎓 Next Steps

1. ✅ Get it running locally
2. ✅ Test with multiple users
3. ✅ Deploy to staging
4. ✅ Monitor performance
5. ✅ Deploy to production

## 💡 Pro Tips

1. **Use Redis Persistence** - Enable RDB or AOF for production
2. **Monitor Memory** - Set Redis maxmemory policy
3. **Enable SSL** - Use wss:// for secure WebSocket
4. **Rate Limit** - Prevent spam with rate limiting
5. **Log Activity** - Monitor WebSocket connections

## 🆘 Need Help?

1. Check browser console for errors
2. Check Django logs for backend errors
3. Check Redis logs: `redis-cli monitor`
4. Read the full setup guide
5. Check WebSocket connection status

## ✨ Features Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Live Feed | ✅ | Posts update in real-time |
| Comments | ✅ | Comment instantly, see live |
| Sharing | ✅ | Share to social media |
| Online Users | ✅ | See who's active |
| Notifications | ✅ | Get alerts for activity |
| Stories | ✅ | Real-time story updates |
| Reactions | ✅ | React to posts/comments |
| Typing Indicators | ⏳ | Coming soon |
| Read Receipts | ⏳ | Coming soon |
| Video Calls | ⏳ | Coming soon |

## 🎉 You're All Set!

Your real-time social platform is now live. Users can:
- See posts instantly
- Comment in real-time
- Share to social media
- See who's online
- Get notifications

Enjoy! 🚀
