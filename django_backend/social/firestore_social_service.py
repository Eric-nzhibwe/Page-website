"""
Firestore Social Service — Phase 6
=====================================
Drop-in replacement for Post, Comment, and PostReaction PostgreSQL queries.
Used by social/views.py when settings.FIRESTORE_COLLECTIONS['social'] is True.

Follows stay in PostgreSQL — they are still queried by challenges/views.py
and users/views.py, so migrating them early would require cross-app changes.
Stories are low-volume and are also kept in PostgreSQL for now.

Firestore collection layout
---------------------------
  social_posts/
    {post_id}/
      id               : str   — UUID
      author_id        : str
      author_username  : str   — denormalised
      author_avatar    : str | null
      author_tier      : str
      content          : str
      post_type        : str   — text|achievement|challenge|media
      media_url        : str | null
      media_type       : str
      achievement_badge: dict
      challenge_id     : str
      reaction_count   : int
      comment_count    : int
      share_count      : int
      created_at       : Timestamp
      updated_at       : Timestamp

      comments/          ← sub-collection
        {comment_id}/
          id             : str
          post_id        : str
          author_id      : str
          author_username: str
          author_avatar  : str | null
          content        : str
          parent_id      : str | null
          reaction_count : int
          created_at     : Timestamp

      reactions/         ← sub-collection
        {user_id}/       ← doc ID = user_id so uniqueness is free
          user_id        : str
          reaction_type  : str
          created_at     : Timestamp

Required Firestore composite indexes
(Firebase Console → Firestore → Indexes → Composite):

  social_posts
  ├── author_id ASC, created_at DESC            (user's own posts)
  └── created_at DESC                           (global feed — auto single-field)
"""

import logging
import uuid
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger          = logging.getLogger(__name__)
POSTS_COLL      = 'social_posts'
BATCH_SIZE      = 400


# ─────────────────────────────────────────────────────────────────────────────
#  Posts — write
# ─────────────────────────────────────────────────────────────────────────────

def create_post(author, validated_data: dict, media_url: str = None) -> dict:
    """Save a new post document.  Returns the formatted dict."""
    db = get_firestore()
    if db is None:
        return {}

    post_id = str(uuid.uuid4())
    now     = datetime.now(tz=timezone.utc)

    doc = {
        'id':               post_id,
        'author_id':        str(author.id),
        'author_username':  author.username,
        'author_avatar':    _avatar(author),
        'author_tier':      getattr(author, 'access_tier', 'Bronze'),
        'content':          validated_data.get('content', ''),
        'post_type':        validated_data.get('post_type', 'text'),
        'media_url':        media_url or validated_data.get('media_url') or None,
        'media_type':       validated_data.get('media_type', ''),
        'achievement_badge': validated_data.get('achievement_badge', {}),
        'challenge_id':     validated_data.get('challenge_id', ''),
        'reaction_count':   0,
        'comment_count':    0,
        'share_count':      0,
        'created_at':       now,
        'updated_at':       now,
    }

    try:
        db.collection(POSTS_COLL).document(post_id).set(doc)
        return _fmt_post(doc)
    except Exception as exc:
        logger.error(f'Firestore create_post error: {exc}')
        return {}


def delete_post(post_id: str, user_id: str) -> bool:
    """Delete a post and its sub-collections. Returns True on success."""
    db = get_firestore()
    if db is None:
        return False

    try:
        ref  = db.collection(POSTS_COLL).document(str(post_id))
        snap = ref.get()
        if not snap.exists:
            return False
        if snap.to_dict().get('author_id') != str(user_id):
            return False  # not the owner

        _delete_subcollection(ref.collection('comments'))
        _delete_subcollection(ref.collection('reactions'))
        ref.delete()
        return True
    except Exception as exc:
        logger.error(f'Firestore delete_post error: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Posts — read
# ─────────────────────────────────────────────────────────────────────────────

def get_post(post_id: str, requesting_user=None) -> dict | None:
    """Fetch a single post by ID."""
    db = get_firestore()
    if db is None:
        return None

    try:
        snap = db.collection(POSTS_COLL).document(str(post_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        d['id'] = snap.id
        post = _fmt_post(d)
        if requesting_user:
            post['user_reaction'] = _get_user_reaction(post_id, requesting_user.id)
        return post
    except Exception as exc:
        logger.error(f'Firestore get_post error: {exc}')
        return None


def get_feed(followed_user_ids: list, current_user_id: str,
             limit: int = 40) -> list:
    """
    Return the combined feed: own posts + posts from followed users,
    newest first.  Firestore doesn't support OR queries across different
    author_ids in a single request, so we fetch own posts + each followed
    user's posts in parallel chunks and merge/sort client-side.
    """
    db = get_firestore()
    if db is None:
        return []

    all_ids = list({str(uid) for uid in followed_user_ids} | {str(current_user_id)})
    results = []
    # Firestore 'in' supports max 30 values
    chunks  = [all_ids[i:i+30] for i in range(0, len(all_ids), 30)]

    try:
        for chunk in chunks:
            docs = (
                db.collection(POSTS_COLL)
                .where('author_id', 'in', chunk)
                .order_by('created_at', direction='DESCENDING')
                .limit(limit)
                .stream()
            )
            for doc in docs:
                d = doc.to_dict()
                d['id'] = doc.id
                results.append(_fmt_post(d))

        # Sort merged results by created_at descending and truncate
        results.sort(key=lambda p: p.get('created_at') or '', reverse=True)
        return results[:limit]
    except Exception as exc:
        logger.error(f'Firestore get_feed error: {exc}')
        return []


def get_user_posts(user_id: str, limit: int = 40) -> list:
    """Return posts authored by a specific user."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(POSTS_COLL)
            .where('author_id', '==', str(user_id))
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_fmt_post(doc.to_dict() | {'id': doc.id}) for doc in docs]
    except Exception as exc:
        logger.error(f'Firestore get_user_posts error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Comments
# ─────────────────────────────────────────────────────────────────────────────

def add_comment(post_id: str, author, content: str,
                parent_id: str = None) -> dict:
    """Add a top-level or reply comment to a post."""
    db = get_firestore()
    if db is None:
        return {}

    comment_id = str(uuid.uuid4())
    now        = datetime.now(tz=timezone.utc)
    doc        = {
        'id':               comment_id,
        'post_id':          str(post_id),
        'author_id':        str(author.id),
        'author_username':  author.username,
        'author_avatar':    _avatar(author),
        'content':          content,
        'parent_id':        parent_id,
        'reaction_count':   0,
        'created_at':       now,
        'updated_at':       now,
    }

    try:
        post_ref = db.collection(POSTS_COLL).document(str(post_id))
        post_ref.collection('comments').document(comment_id).set(doc)
        # Increment comment_count on post atomically
        from google.cloud.firestore_v1 import Increment
        post_ref.update({'comment_count': Increment(1), 'updated_at': now})
        return _fmt_comment(doc)
    except Exception as exc:
        logger.error(f'Firestore add_comment error: {exc}')
        return {}


def get_comments(post_id: str, limit: int = 100) -> list:
    """Return top-level comments for a post, oldest first."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(POSTS_COLL)
            .document(str(post_id))
            .collection('comments')
            .where('parent_id', '==', None)
            .order_by('created_at')
            .limit(limit)
            .stream()
        )
        return [_fmt_comment(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_comments error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Reactions
# ─────────────────────────────────────────────────────────────────────────────

def react_to_post(post_id: str, user, reaction_type: str = 'fire') -> dict:
    """
    Add or update a reaction.  Doc ID = user_id so uniqueness is enforced
    automatically (one reaction per user per post).
    """
    db = get_firestore()
    if db is None:
        return {}

    now       = datetime.now(tz=timezone.utc)
    post_ref  = db.collection(POSTS_COLL).document(str(post_id))
    react_ref = post_ref.collection('reactions').document(str(user.id))

    try:
        existing = react_ref.get()
        is_new   = not existing.exists
        react_ref.set({
            'user_id':       str(user.id),
            'username':      user.username,
            'reaction_type': reaction_type,
            'created_at':    now,
        })

        if is_new:
            from google.cloud.firestore_v1 import Increment
            post_ref.update({'reaction_count': Increment(1), 'updated_at': now})

        return {'user_id': str(user.id), 'reaction_type': reaction_type,
                'created': is_new}
    except Exception as exc:
        logger.error(f'Firestore react_to_post error: {exc}')
        return {}


def unreact_to_post(post_id: str, user) -> bool:
    """Remove a reaction.  Returns True if it existed and was removed."""
    db = get_firestore()
    if db is None:
        return False

    now       = datetime.now(tz=timezone.utc)
    post_ref  = db.collection(POSTS_COLL).document(str(post_id))
    react_ref = post_ref.collection('reactions').document(str(user.id))

    try:
        snap = react_ref.get()
        if not snap.exists:
            return False
        react_ref.delete()
        from google.cloud.firestore_v1 import Increment
        post_ref.update({'reaction_count': Increment(-1), 'updated_at': now})
        return True
    except Exception as exc:
        logger.error(f'Firestore unreact_to_post error: {exc}')
        return False


def _get_user_reaction(post_id: str, user_id: str) -> str | None:
    """Return the reaction_type for a specific user, or None."""
    db = get_firestore()
    if db is None:
        return None
    try:
        snap = (db.collection(POSTS_COLL)
                .document(str(post_id))
                .collection('reactions')
                .document(str(user_id))
                .get())
        return snap.to_dict().get('reaction_type') if snap.exists else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helpers
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(post_queryset):
    """
    One-time migration: copy Post + Comment + PostReaction rows to Firestore.

    Usage:
        from social.models import Post
        from social.firestore_social_service import migrate_from_postgres
        migrate_from_postgres(
            Post.objects.select_related('author')
                        .prefetch_related('comments__author', 'reactions__user')
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate social: Firestore not available.')
        return 0

    migrated = 0
    batch    = db.batch()
    count    = 0

    def _flush():
        nonlocal batch, count
        if count:
            batch.commit()
            batch = db.batch()
            count = 0

    for post in post_queryset.iterator():
        post_id  = str(post.id)
        post_ref = db.collection(POSTS_COLL).document(post_id)

        post_doc = {
            'id':               post_id,
            'author_id':        str(post.author_id),
            'author_username':  post.author.username,
            'author_avatar':    _avatar(post.author),
            'author_tier':      getattr(post.author, 'access_tier', 'Bronze'),
            'content':          post.content,
            'post_type':        post.post_type,
            'media_url':        post.media_url,
            'media_type':       post.media_type or '',
            'achievement_badge': post.achievement_badge or {},
            'challenge_id':     post.challenge_id or '',
            'reaction_count':   post.reaction_count,
            'comment_count':    post.comment_count,
            'share_count':      post.share_count,
            'created_at':       post.created_at,
            'updated_at':       post.updated_at,
            '_pg_id':           post_id,
        }
        batch.set(post_ref, post_doc)
        count    += 1
        migrated += 1
        if count >= BATCH_SIZE:
            _flush()

        for comment in post.comments.select_related('author').all():
            c_ref = post_ref.collection('comments').document(str(comment.id))
            batch.set(c_ref, {
                'id':               str(comment.id),
                'post_id':          post_id,
                'author_id':        str(comment.author_id),
                'author_username':  comment.author.username,
                'author_avatar':    _avatar(comment.author),
                'content':          comment.content,
                'parent_id':        str(comment.parent_comment_id) if comment.parent_comment_id else None,
                'reaction_count':   comment.reaction_count,
                'created_at':       comment.created_at,
                'updated_at':       comment.updated_at,
                '_pg_id':           str(comment.id),
            })
            count    += 1
            migrated += 1
            if count >= BATCH_SIZE:
                _flush()

        for reaction in post.reactions.select_related('user').all():
            r_ref = post_ref.collection('reactions').document(str(reaction.user_id))
            batch.set(r_ref, {
                'user_id':       str(reaction.user_id),
                'username':      reaction.user.username,
                'reaction_type': reaction.reaction_type,
                'created_at':    reaction.created_at,
                '_pg_id':        str(reaction.id),
            })
            count    += 1
            migrated += 1
            if count >= BATCH_SIZE:
                _flush()

    _flush()
    logger.info(f'migrate social: done — {migrated} documents written.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    if hasattr(val, 'timestamp'):
        from datetime import datetime as _dt
        return _dt.fromtimestamp(val.timestamp(), tz=timezone.utc).isoformat()
    return str(val)


def _avatar(user) -> str | None:
    try:
        return user.profile_image.url if user.profile_image else None
    except Exception:
        return None


def _fmt_post(d: dict) -> dict:
    return {
        'id':               d.get('id', ''),
        'author': {
            'id':            d.get('author_id', ''),
            'username':      d.get('author_username', ''),
            'profile_image': d.get('author_avatar'),
            'access_tier':   d.get('author_tier', 'Bronze'),
        },
        'content':          d.get('content', ''),
        'post_type':        d.get('post_type', 'text'),
        'media_url':        d.get('media_url'),
        'media_type':       d.get('media_type', ''),
        'achievement_badge': d.get('achievement_badge', {}),
        'challenge_id':     d.get('challenge_id', ''),
        'reaction_count':   d.get('reaction_count', 0),
        'comment_count':    d.get('comment_count', 0),
        'share_count':      d.get('share_count', 0),
        'user_reaction':    d.get('user_reaction'),
        'created_at':       _ts(d.get('created_at')),
        'updated_at':       _ts(d.get('updated_at')),
    }


def _fmt_comment(d: dict) -> dict:
    return {
        'id':               d.get('id', ''),
        'post_id':          d.get('post_id', ''),
        'author': {
            'id':            d.get('author_id', ''),
            'username':      d.get('author_username', ''),
            'profile_image': d.get('author_avatar'),
        },
        'content':          d.get('content', ''),
        'parent_id':        d.get('parent_id'),
        'reaction_count':   d.get('reaction_count', 0),
        'created_at':       _ts(d.get('created_at')),
    }


def _delete_subcollection(col_ref, batch_size=400):
    db = get_firestore()
    if db is None:
        return
    docs = list(col_ref.limit(batch_size).stream())
    if not docs:
        return
    b = db.batch()
    for doc in docs:
        b.delete(doc.reference)
    b.commit()
    _delete_subcollection(col_ref, batch_size)
