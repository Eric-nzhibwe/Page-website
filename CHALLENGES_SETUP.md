# Challenges System Setup Guide

## Overview

The challenges system has been migrated from localStorage to a Django backend with real-time functionality. This guide covers setup, API endpoints, and real-time features.

## Backend Setup

### 1. Install Dependencies

Ensure all required packages are in `requirements.txt`:

```bash
pip install -r django_backend/requirements.txt
```

### 2. Run Migrations

```bash
cd django_backend
python manage.py makemigrations challenges
python manage.py migrate challenges
```

### 3. Seed Sample Challenges

```bash
python manage.py seed_challenges
```

This will create 6 sample challenges with different difficulty levels.

### 4. Create Admin User (if not exists)

```bash
python manage.py createsuperuser
```

### 5. Start Django Server

```bash
python manage.py runserver
```

The API will be available at `http://localhost:8000/api/challenges/`

## API Endpoints

### Challenges

- `GET /api/challenges/` - List all challenges
- `GET /api/challenges/active/` - Get active challenges
- `GET /api/challenges/featured/` - Get featured challenges
- `GET /api/challenges/{id}/` - Get single challenge
- `GET /api/challenges/{id}/leaderboard/` - Get challenge leaderboard
- `GET /api/challenges/{id}/activity/` - Get challenge activity feed
- `GET /api/challenges/{id}/stats/` - Get challenge statistics

### Submissions

- `POST /api/submissions/` - Submit to a challenge
- `GET /api/submissions/my_submissions/` - Get user's submissions
- `GET /api/submissions/challenge_submissions/?challenge_id={id}` - Get submissions for a challenge
- `GET /api/submissions/{id}/` - Get single submission

### Leaderboards

- `GET /api/leaderboards/global_leaderboard/` - Get global leaderboard

### Activities

- `GET /api/activities/challenge_activity/?challenge_id={id}` - Get challenge activity
- `GET /api/activities/global_activity/` - Get global activity feed

## Frontend Setup

### 1. Include Required Scripts

The challenges page automatically includes:
- `api-service.js` - API communication
- `realtime-service.js` - WebSocket real-time updates
- `challenges.js` - Main challenges logic

### 2. Authentication

The frontend expects:
- `authToken` in localStorage (JWT or Token)
- `artCurrentUser` in localStorage (user ID)

### 3. API Configuration

Update the API base URL in `scripts/api-service.js` if needed:

```javascript
const API_BASE_URL = 'http://localhost:8000/api';
```

## Real-Time Features

### WebSocket Connection

The system attempts to connect to WebSocket for real-time updates:

```javascript
// Automatically connects on page load
realtimeService.connect();

// Listen for events
realtimeService.on('new_submission', (data) => {
    console.log('New submission:', data);
});

realtimeService.on('leaderboard_update', (data) => {
    console.log('Leaderboard updated:', data);
});
```

### Fallback to Polling

If WebSocket is unavailable, the system falls back to polling every 5 seconds.

## Challenge Model

### Fields

```python
Challenge:
  - id (UUID)
  - title (CharField)
  - description (TextField)
  - image_url (URLField)
  - difficulty (easy, medium, hard, expert)
  - time_limit (minutes)
  - min_word_count / max_word_count
  - submission_rules (JSONField)
  - creativity_weight / relevance_weight / detail_weight (scoring)
  - min_points / max_points
  - status (draft, active, paused, ended)
  - starts_at / ends_at (DateTimeField)
  - is_featured (BooleanField)
  - view_count / submission_count
  - created_by (ForeignKey to User)
  - created_at / updated_at
```

## Submission Model

### Fields

```python
ChallengeSubmission:
  - id (UUID)
  - challenge (ForeignKey)
  - user (ForeignKey)
  - interpretation (TextField)
  - word_count (IntegerField)
  - status (submitted, scored, rejected)
  - creativity_score / relevance_score / detail_score
  - final_score (calculated)
  - submitted_at / scored_at
  - submission_time_seconds
```

## Scoring System

Submissions are scored based on weighted criteria:

```
final_score = (creativity_score * creativity_weight / 100) +
              (relevance_score * relevance_weight / 100) +
              (detail_score * detail_weight / 100)

points_awarded = min_points + (final_score / 100) * (max_points - min_points)
```

## Admin Panel

Access the admin panel at `http://localhost:8000/admin/`

### Challenge Management

- Create new challenges
- Set difficulty, time limits, word counts
- Configure scoring weights
- Set start/end times
- Mark as featured

### Submission Management

- View all submissions
- Score submissions
- View leaderboards
- Monitor activity

## Database Schema

### Tables

- `challenges` - Challenge definitions
- `challenge_submissions` - User submissions
- `challenge_leaderboards` - Cached leaderboard data
- `challenge_activities` - Real-time activity feed

### Indexes

- `challenges(status, ends_at)` - For active challenge queries
- `challenge_submissions(challenge, user)` - For unique constraint
- `challenge_submissions(status)` - For filtering
- `challenge_activities(challenge, created_at)` - For activity feed

## Performance Considerations

### Caching

- Leaderboards are cached and updated on submission
- Activity feed is limited to last 50 entries
- Top submissions are cached in JSON field

### Database Queries

- Use `select_related()` for foreign keys
- Use `prefetch_related()` for reverse relations
- Implement pagination for large result sets

### Real-Time Updates

- WebSocket for instant updates (when available)
- Polling fallback every 5 seconds
- Activity feed limited to 50 most recent entries

## Troubleshooting

### WebSocket Connection Failed

If WebSocket fails to connect:
1. Check if WebSocket server is running
2. Verify CORS settings
3. Check browser console for errors
4. System will automatically fall back to polling

### API Errors

Common errors:

- `401 Unauthorized` - Missing or invalid token
- `400 Bad Request` - Invalid submission data
- `404 Not Found` - Challenge or submission not found
- `409 Conflict` - User already submitted to challenge

### Database Issues

If migrations fail:

```bash
# Reset migrations (development only)
python manage.py migrate challenges zero
python manage.py migrate challenges

# Or create fresh database
rm db.sqlite3
python manage.py migrate
python manage.py seed_challenges
```

## Future Enhancements

- [ ] WebSocket consumer for real-time updates
- [ ] Automated scoring using AI
- [ ] Challenge templates
- [ ] Batch submission processing
- [ ] Advanced analytics dashboard
- [ ] Challenge recommendations
- [ ] Social sharing features
- [ ] Challenge difficulty adjustment based on submissions

## Support

For issues or questions, refer to:
- Django documentation: https://docs.djangoproject.com/
- Django REST Framework: https://www.django-rest-framework.org/
- WebSocket documentation: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
