# Challenges System - Quick Start Guide

## 5-Minute Setup

### Step 1: Run Migrations (1 min)
```bash
cd django_backend
python manage.py migrate challenges
```

### Step 2: Seed Sample Challenges (1 min)
```bash
python manage.py seed_challenges
```

### Step 3: Start Django Server (1 min)
```bash
python manage.py runserver
```

Server will be available at: `http://localhost:8000`

### Step 4: Test API (1 min)
Open browser and visit:
```
http://localhost:8000/api/challenges/active/
```

You should see 6 sample challenges in JSON format.

### Step 5: Access Frontend (1 min)
Navigate to:
```
http://localhost:8000/pages/challenges.html
```

## What You Get

### 6 Sample Challenges
1. **The Forgotten Garden** (Easy) - 10-30 points
2. **Urban Chaos** (Medium) - 30-60 points
3. **Nature's Masterpiece** (Medium) - 30-60 points
4. **Abstract Emotions** (Hard) - 60-100 points
5. **The Human Condition** (Hard) - 60-100 points
6. **Mastery of Vision** (Expert) - 100-200 points

### Real-Time Features
- Live leaderboards
- Activity feed
- Countdown timers
- Multi-user synchronization

## Testing the System

### Test 1: View Challenges
1. Go to challenges page
2. See all 6 challenges displayed
3. Click on a challenge to view details

### Test 2: Submit to Challenge
1. Click "Participate" on any challenge
2. Write an interpretation (50-200 words for Easy)
3. Click "Submit Interpretation"
4. See submission in "My Submissions"

### Test 3: View Leaderboard
1. Open a challenge
2. Scroll to "Live Leaderboard"
3. See top submissions in real-time

### Test 4: Real-Time Updates
1. Open challenge in two browser windows
2. Submit from one window
3. See update in other window (within 5 seconds)

## API Quick Reference

### Get Active Challenges
```bash
curl http://localhost:8000/api/challenges/active/
```

### Get Challenge Details
```bash
curl http://localhost:8000/api/challenges/{challenge_id}/
```

### Get Leaderboard
```bash
curl http://localhost:8000/api/challenges/{challenge_id}/leaderboard/
```

### Submit to Challenge
```bash
curl -X POST http://localhost:8000/api/submissions/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "challenge": "challenge-uuid",
    "interpretation": "Your interpretation text here...",
    "submission_time_seconds": 300
  }'
```

## Admin Panel

### Access Admin
1. Create superuser: `python manage.py createsuperuser`
2. Go to: `http://localhost:8000/admin/`
3. Login with superuser credentials

### Manage Challenges
1. Click "Challenges" in admin
2. Create, edit, or delete challenges
3. Set difficulty, time limits, scoring weights
4. Mark as featured

### View Submissions
1. Click "Challenge Submissions" in admin
2. See all user submissions
3. View scores and details

## Troubleshooting

### Issue: "No challenges available"
**Solution:** Run seed command
```bash
python manage.py seed_challenges
```

### Issue: API returns 401 Unauthorized
**Solution:** Check authentication token
```javascript
// In browser console
localStorage.getItem('authToken')
```

### Issue: WebSocket connection failed
**Solution:** This is normal - system falls back to polling
- Check browser console for errors
- Verify server is running
- WebSocket support is optional

### Issue: Submission validation error
**Solution:** Check word count
- Minimum words: 50 (Easy), 100 (Medium), 150 (Hard), 250 (Expert)
- Maximum words: 200 (Easy), 300 (Medium), 400 (Hard), 600 (Expert)

## Database

### View Database
```bash
# SQLite (development)
sqlite3 db.sqlite3

# PostgreSQL (production)
psql -U postgres -d artx_platform
```

### Check Challenges
```sql
SELECT id, title, difficulty, status FROM challenges;
```

### Check Submissions
```sql
SELECT user_id, challenge_id, final_score FROM challenge_submissions;
```

## Performance Tips

### For Development
- Use SQLite (default)
- Enable DEBUG mode
- Use polling (WebSocket optional)

### For Production
- Use PostgreSQL
- Disable DEBUG mode
- Implement WebSocket consumer
- Enable caching
- Use CDN for images

## Next Steps

1. **Customize Challenges**
   - Edit sample challenges in admin
   - Create new challenges
   - Set custom scoring weights

2. **Integrate with User System**
   - Link challenges to user profiles
   - Track user progress
   - Award badges/achievements

3. **Add Analytics**
   - Track submission trends
   - Monitor user engagement
   - Analyze difficulty distribution

4. **Implement WebSocket**
   - Install Django Channels
   - Create WebSocket consumer
   - Enable real-time updates

## Common Commands

```bash
# Run migrations
python manage.py migrate challenges

# Seed challenges
python manage.py seed_challenges

# Create superuser
python manage.py createsuperuser

# Run server
python manage.py runserver

# Run tests
python manage.py test challenges

# Create backup
python manage.py dumpdata challenges > challenges_backup.json

# Restore backup
python manage.py loaddata challenges_backup.json

# Reset database
python manage.py migrate challenges zero
python manage.py migrate challenges
```

## File Structure

```
django_backend/
├── challenges/
│   ├── migrations/
│   │   ├── 0001_initial.py
│   │   └── __init__.py
│   ├── management/
│   │   └── commands/
│   │       └── seed_challenges.py
│   ├── admin.py
│   ├── apps.py
│   ├── models.py
│   ├── serializers.py
│   ├── signals.py
│   ├── urls.py
│   ├── views.py
│   └── __init__.py

scripts/
├── api-service.js
├── realtime-service.js
└── challenges.js

pages/
└── challenges.html
```

## Support

For detailed information, see:
- `CHALLENGES_SETUP.md` - Complete setup guide
- `CHALLENGES_MIGRATION_SUMMARY.md` - Architecture overview
- Django docs: https://docs.djangoproject.com/

## Success Checklist

- [ ] Migrations run successfully
- [ ] Sample challenges created
- [ ] Django server running
- [ ] API endpoints accessible
- [ ] Frontend loads challenges
- [ ] Can submit to challenge
- [ ] Leaderboard displays
- [ ] Real-time updates working

Once all items are checked, your challenges system is ready to use!
