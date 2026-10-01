# Database Indexes — PAGE Platform

> **This document covers PostgreSQL indexes only** (Django ORM / `models.Index`).
> For Firestore composite indexes see [`firestore.indexes.json`](./firestore.indexes.json)
> — that file is deployed with `firebase deploy --only firestore:indexes`.

This document explains what database indexes are, why they matter for PAGE,
and exactly how to add them to each model. All examples are ready to copy
into the codebase.

---

## What is an index?

An index is a separate data structure that PostgreSQL builds alongside a table.
It lets the database jump directly to matching rows instead of scanning every
row one by one.

**Without an index** — finding all challenges created by a specific user scans
the entire `challenges` table row-by-row. At 10 000 rows that's fast. At
1 000 000 rows it's slow enough to time out.

**With an index** — the same query takes the same time whether there are 100
rows or 100 million, because the database follows a pointer straight to the
answer.

---

## When to add an index

Add an index on a column (or combination of columns) when:

- It appears in a `WHERE` clause: `Challenge.objects.filter(status='active')`
- It appears in `ORDER BY`: `.order_by('-created_at')`
- It is a foreign key that you query through: `Submission.objects.filter(user=request.user)`
- It is used in a JOIN: `Follow.objects.filter(follower=user)`
- You see slow queries in Render logs with `Seq Scan` in `EXPLAIN` output

Do **not** add indexes on columns that are:
- Updated extremely frequently (indexes slow down writes slightly)
- Never filtered on or sorted by
- On very small tables (< 1 000 rows — the overhead is not worth it)

---

## How Django indexes work

You define indexes inside the model's `Meta` class. Django generates the SQL
and applies it during `python manage.py migrate`. You never write SQL by hand.

```python
class Meta:
    indexes = [
        models.Index(fields=['status', 'created_at']),
    ]
```

This creates a single composite index covering both `status` and `created_at`.

---

## Index types available in Django + PostgreSQL

| Type | Django class | Use case |
|---|---|---|
| B-tree (default) | `models.Index` | Equality, range, ORDER BY — covers 90 % of cases |
| Unique | `models.UniqueConstraint` | Enforce uniqueness AND index simultaneously |
| Partial | `models.Index(condition=Q(...))` | Only index rows matching a condition |
| GIN | `GinIndex` (django.contrib.postgres) | Full-text search, JSONField contains |
| Hash | `HashIndex` | Equality-only lookups, slightly faster than B-tree for that case |

---

## PAGE Platform — recommended indexes per model

### 1. User (`users/models.py`)

The queries that hit the `users` table most often:

- Login by email: `User.objects.get(email__iexact=...)`
- Login by username: `User.objects.get(username__iexact=...)`
- Leaderboard: `.order_by('-prestige_points')`
- Tier display: `.filter(access_tier='Gold')`

```python
class Meta:
    db_table = 'users'
    indexes = [
        # Login lookup — email is already unique so it has an implicit index,
        # but adding a case-insensitive functional index speeds up __iexact.
        models.Index(
            fields=['email'],
            name='users_email_idx',
        ),
        # Login by username
        models.Index(
            fields=['username'],
            name='users_username_idx',
        ),
        # Leaderboard queries
        models.Index(
            fields=['-prestige_points'],
            name='users_prestige_desc_idx',
        ),
        # Tier filtering
        models.Index(
            fields=['access_tier'],
            name='users_access_tier_idx',
        ),
    ]
```

### 2. Challenge (`challenges/models.py`)

- Active challenge feed: `.filter(status='active', ends_at__gte=now)`
- Challenges by creator: `.filter(created_by=user)`
- Ordered by newest: `.order_by('-created_at')`

```python
class Meta:
    db_table = 'challenges'
    indexes = [
        # The most common query — active feed with time filter
        models.Index(
            fields=['status', 'ends_at'],
            name='challenges_status_ends_at_idx',
        ),
        # "My Challenges" — creator view
        models.Index(
            fields=['created_by', '-created_at'],
            name='challenges_creator_idx',
        ),
        # General ordering
        models.Index(
            fields=['-created_at'],
            name='challenges_created_at_idx',
        ),
        # Difficulty filter
        models.Index(
            fields=['difficulty'],
            name='challenges_difficulty_idx',
        ),
    ]
```

**Partial index** — only index active challenges (smaller, faster):

```python
from django.db.models import Q

models.Index(
    fields=['ends_at', 'created_by'],
    condition=Q(status='active'),
    name='challenges_active_partial_idx',
)
```

### 3. ChallengeSubmission (`challenges/models.py`)

- User's own submissions: `.filter(user=user)`
- Leaderboard for a challenge: `.filter(challenge=c).order_by('-final_score')`
- Scored submissions: `.filter(status='scored')`

```python
class Meta:
    db_table = 'challenge_submissions'
    indexes = [
        # User submission history
        models.Index(
            fields=['user', '-submitted_at'],
            name='submissions_user_idx',
        ),
        # Per-challenge leaderboard
        models.Index(
            fields=['challenge', '-final_score'],
            name='submissions_challenge_score_idx',
        ),
        # Status filter
        models.Index(
            fields=['status'],
            name='submissions_status_idx',
        ),
    ]
```

### 4. Follow (`social/models.py`)

- Who does user X follow: `.filter(follower=user)`
- Who follows user X: `.filter(following=user)`
- Both of these run on every feed page load — high priority.

```python
class Meta:
    db_table = 'social_follows'
    indexes = [
        models.Index(
            fields=['follower'],
            name='follow_follower_idx',
        ),
        models.Index(
            fields=['following'],
            name='follow_following_idx',
        ),
    ]
    # Prevent duplicate follows
    constraints = [
        models.UniqueConstraint(
            fields=['follower', 'following'],
            name='follow_unique_pair',
        )
    ]
```

### 5. Post (`social/models.py`)

- Social feed (author + followed): `.filter(Q(author=user)|Q(author__in=followed))`
- Feed ordering: `.order_by('-created_at')`
- Voice posts filter: `.filter(post_type='voice')`

```python
class Meta:
    db_table = 'social_posts'
    ordering = ['-created_at']
    indexes = [
        # Feed — author lookup + ordering
        models.Index(
            fields=['author', '-created_at'],
            name='posts_author_created_idx',
        ),
        # Global feed ordering
        models.Index(
            fields=['-created_at'],
            name='posts_created_at_idx',
        ),
        # Post type filter (voice, media, text, achievement)
        models.Index(
            fields=['post_type'],
            name='posts_post_type_idx',
        ),
    ]
```

### 6. Comment (`social/models.py`)

- Comments on a post: `.filter(post_id=post_id, parent_comment__isnull=True)`

```python
class Meta:
    db_table = 'social_comments'
    ordering = ['created_at']
    indexes = [
        # Per-post comment list (top-level only)
        models.Index(
            fields=['post', 'created_at'],
            name='comments_post_created_idx',
        ),
        # User's comments
        models.Index(
            fields=['author', '-created_at'],
            name='comments_author_idx',
        ),
    ]
```

### 7. PostReaction (`social/models.py`)

- Reactions on a post: `.filter(post=post)`
- User's reaction on a post: `.filter(post=post, user=user)`

```python
class Meta:
    db_table = 'social_post_reactions'
    unique_together = ['post', 'user']   # already implies an index
    indexes = [
        # Reaction lookup per post
        models.Index(
            fields=['post', 'created_at'],
            name='post_reactions_post_idx',
        ),
        # User's reaction history
        models.Index(
            fields=['user', 'created_at'],
            name='post_reactions_user_idx',
        ),
    ]
```

### 8. Story (`social/models.py`)

- Active story feed: `.filter(expires_at__gt=now)`
- Stories by author: `.filter(author=user)`
- Feed for followed users: `Story.objects.filter(Q(author=user)|Q(author__in=followed), expires_at__gt=now)`

```python
class Meta:
    db_table = 'social_stories'
    ordering = ['-created_at']
    indexes = [
        # Author + time (user's own stories)
        models.Index(
            fields=['author', '-created_at'],
            name='stories_author_created_idx',
        ),
        # Expiry check — the most critical filter on every feed load
        models.Index(
            fields=['expires_at'],
            name='stories_expires_at_idx',
        ),
        # Partial: only non-expired stories (much smaller index)
        models.Index(
            fields=['author', '-created_at'],
            condition=Q(expires_at__gt=timezone.now()),
            name='stories_active_author_idx',
        ),
    ]
```

> **Note:** The partial index condition uses `timezone.now()` at migration
> generation time. For a static partial index, use a fixed threshold or
> omit the partial condition and rely on the plain `expires_at` index.

### 9. StoryView (`social/models.py`)

- Viewer list for a story: `.filter(story=story).order_by('-viewed_at')`
- Has user viewed a story: `.filter(story=story, viewer=user).exists()`

```python
class Meta:
    db_table = 'social_story_views'
    unique_together = ['story', 'viewer']
    indexes = [
        # Viewer list per story
        models.Index(
            fields=['story', '-viewed_at'],
            name='story_views_story_idx',
        ),
        # User's view history
        models.Index(
            fields=['viewer', '-viewed_at'],
            name='story_views_viewer_idx',
        ),
    ]
```

### 10. UserActivity (`users/models.py`)

- Activity feed per user: `.filter(user=user).order_by('-created_at')`

```python
class Meta:
    db_table = 'user_activities'
    indexes = [
        models.Index(
            fields=['user', '-created_at'],
            name='activity_user_created_idx',
        ),
    ]
```

### 11. Notification (`notifications/models.py`)

- Unread count badge: `.filter(user=user, is_read=False)`
- Notification list: `.filter(user=user).order_by('-created_at')`

```python
class Meta:
    db_table = 'notifications'
    indexes = [
        # Unread badge query — most frequent notification query
        models.Index(
            fields=['user', 'is_read'],
            name='notif_user_unread_idx',
        ),
        # Full notification list
        models.Index(
            fields=['user', '-created_at'],
            name='notif_user_created_idx',
        ),
    ]
```

### 12. Message / Conversation (`messenger/models.py`)

- Messages in a conversation: `.filter(conversation=c).order_by('timestamp')`
- Unread messages: `.filter(conversation__participants=user, read=False).exclude(sender=user)`
- User's conversations: via `Conversation.participants` M2M (auto-indexed)

```python
# Message model Meta
class Meta:
    ordering = ['timestamp']
    indexes = [
        # Per-conversation message list (chronological)
        models.Index(
            fields=['conversation', 'timestamp'],
            name='message_conversation_ts_idx',
        ),
        # Unread count query
        models.Index(
            fields=['conversation', 'read', 'sender'],
            name='message_conv_read_sender_idx',
        ),
    ]
```

### 13. ChatConversation / ChatMessage (`chatbot/models.py`)

- User's conversations: `.filter(user=user).order_by('-updated_at')`
- Messages in a conversation: `.filter(conversation=conv).order_by('created_at')`

```python
# ChatConversation Meta
class Meta:
    indexes = [
        models.Index(
            fields=['user', '-updated_at'],
            name='chat_conv_user_updated_idx',
        ),
    ]

# ChatMessage Meta
class Meta:
    indexes = [
        models.Index(
            fields=['conversation', 'created_at'],
            name='chat_msg_conv_created_idx',
        ),
    ]
```

### 14. PollChallenge / DebateChallenge / QAChallenge (`challenges/models.py`)

All three social challenge types share the same pattern — active feed + creator:

```python
class Meta:
    db_table = 'poll_challenges'
    indexes = [
        models.Index(fields=['is_active', '-created_at'], name='poll_active_idx'),
        models.Index(fields=['created_by'], name='poll_creator_idx'),
    ]
```

Repeat with `debate_challenges` and `qa_challenges` table names.

---

## Step-by-step: adding an index

### Step 1 — Edit the model

Open the relevant `models.py` and add (or extend) the `indexes` list inside
`Meta`:

```python
class Meta:
    db_table = 'users'
    verbose_name = 'User'
    verbose_name_plural = 'Users'
    indexes = [
        models.Index(fields=['-prestige_points'], name='users_prestige_desc_idx'),
        models.Index(fields=['access_tier'],       name='users_access_tier_idx'),
    ]
```

### Step 2 — Create the migration

```bash
cd django_backend
python manage.py makemigrations <app_name> --name add_<model>_indexes
```

Example:
```bash
python manage.py makemigrations social --name add_post_story_indexes
python manage.py makemigrations messenger --name add_message_indexes
python manage.py makemigrations chatbot --name add_chat_indexes
```

Open the generated file and confirm it contains only `migrations.AddIndex`
operations (no unexpected column changes).

### Step 3 — Apply locally (optional but recommended)

```bash
python manage.py migrate
```

Check it worked:

```bash
python manage.py dbshell
# Inside psql:
\d social_posts
# Look for "Indexes:" section at the bottom
```

### Step 4 — Deploy to Render

Push to your `main` branch. Render runs `start.sh` which calls
`python manage.py migrate --no-input` — the new migration runs automatically
and the indexes are created on the production database.

No downtime. PostgreSQL creates indexes without locking reads on new
(low-traffic) tables. For very large existing production tables, use
`CONCURRENTLY` (see Advanced section below).

---

## Checking if your queries actually use the index

Connect to the Render PostgreSQL shell or use Django shell:

```python
# In Django shell: python manage.py shell
from django.db import connection

with connection.cursor() as c:
    c.execute("""
        EXPLAIN ANALYZE
        SELECT * FROM challenges
        WHERE status = 'active' AND ends_at >= NOW()
        ORDER BY created_at DESC
        LIMIT 20
    """)
    for row in c.fetchall():
        print(row[0])
```

Look for:
- `Index Scan using challenges_status_ends_at_idx` → ✅ index is being used
- `Seq Scan on challenges` → ❌ index is not being used (wrong columns, or
  table is too small for the planner to bother)

---

## Advanced: creating an index without locking the table

On a live production table with thousands of rows, a regular `CREATE INDEX`
locks writes for the duration. Use `CONCURRENTLY` to avoid this:

```python
# In a custom migration file
from django.db import migrations

class Migration(migrations.Migration):
    atomic = False  # Required for CONCURRENTLY

    operations = [
        migrations.RunSQL(
            sql="""
                CREATE INDEX CONCURRENTLY IF NOT EXISTS challenges_status_ends_at_idx
                ON challenges (status, ends_at);
            """,
            reverse_sql="DROP INDEX IF EXISTS challenges_status_ends_at_idx;",
        ),
    ]
```

Note: `atomic = False` is required because PostgreSQL does not allow
`CREATE INDEX CONCURRENTLY` inside a transaction. On Render free tier with
small tables this is rarely needed — the standard `models.Index` approach
is fine.

---

## Quick reference — index naming convention

Use a consistent pattern so indexes are easy to identify in `\d tablename`:

```
{table}_{columns}_{type}_idx

Examples:
  users_prestige_desc_idx
  challenges_status_ends_at_idx
  submissions_user_idx
  follow_follower_idx
  posts_author_created_idx
  stories_expires_at_idx
  message_conversation_ts_idx
```

---

## Summary — indexes to create (priority order)

These are the queries PAGE runs on every page load. Create these first via
`makemigrations` → `migrate`:

| App | Model | Fields | Migration name | Why |
|---|---|---|---|---|
| `social` | `Post` | `(author, -created_at)` | `add_post_indexes` | Social feed |
| `social` | `Post` | `(-created_at)` | `add_post_indexes` | Feed ordering |
| `social` | `Story` | `(expires_at)` | `add_story_indexes` | Active story feed |
| `social` | `Story` | `(author, -created_at)` | `add_story_indexes` | User's stories |
| `social` | `StoryView` | `(story, -viewed_at)` | `add_story_indexes` | Story viewer list |
| `social` | `Follow` | `(follower,)` | `add_follow_indexes` | Feed — who do I follow |
| `social` | `Follow` | `(following,)` | `add_follow_indexes` | Profile — follower count |
| `social` | `Comment` | `(post, created_at)` | `add_comment_indexes` | Post comment list |
| `social` | `PostReaction` | `(post, created_at)` | `add_reaction_indexes` | Reaction list |
| `messenger` | `Message` | `(conversation, timestamp)` | `add_message_indexes` | Message history |
| `messenger` | `Message` | `(conversation, read, sender)` | `add_message_indexes` | Unread count |
| `challenges` | `Challenge` | `(status, ends_at)` | `add_challenge_indexes` | Active challenge feed |
| `challenges` | `ChallengeSubmission` | `(user, -submitted_at)` | `add_submission_indexes` | Submission history |
| `challenges` | `ChallengeSubmission` | `(challenge, -final_score)` | `add_submission_indexes` | Leaderboard |
| `notifications` | `Notification` | `(user, is_read)` | `add_notif_indexes` | Unread badge |
| `chatbot` | `ChatConversation` | `(user, -updated_at)` | `add_chat_indexes` | Conversation list |
| `chatbot` | `ChatMessage` | `(conversation, created_at)` | `add_chat_indexes` | Chat history |
| `users` | `User` | `(-prestige_points)` | `add_user_indexes` | Leaderboard |
| `users` | `UserActivity` | `(user, -created_at)` | `add_activity_indexes` | Activity feed |

Foreign key columns (`user`, `created_by`, `challenge`, `follower`, `following`)
already get a B-tree index automatically because Django sets `db_index=True` on
all `ForeignKey` fields. You only need explicit indexes for **composite** column
combinations or descending sorts.

---

## Commands to run all at once

```bash
cd django_backend

# Social
python manage.py makemigrations social --name add_post_story_follow_indexes

# Messenger
python manage.py makemigrations messenger --name add_message_indexes

# Challenges
python manage.py makemigrations challenges --name add_challenge_submission_indexes

# Notifications
python manage.py makemigrations notifications --name add_notification_indexes

# Chatbot
python manage.py makemigrations chatbot --name add_chat_indexes

# Users
python manage.py makemigrations users --name add_user_indexes

# Apply everything
python manage.py migrate
```
