"""
Firestore Story Service
=======================
Handles story persistence in Firestore so stories survive Render
re-deploys and page reloads.  Media files are uploaded to Cloudinary
via Django's DEFAULT_FILE_STORAGE backend; only the resulting URL is
stored in Firestore.

Firestore collection layout
---------------------------
  social_stories/
    {story_id}/
      id              : str   — UUID
      author_id       : str
      author_username : str   — denormalised
      author_avatar   : str | null
      content         : str
      media_url       : str   — Cloudinary URL (permanent)
      media_type      : str   — 'image' | 'video'
      view_count      : int
      created_at      : Timestamp
      expires_at      : Timestamp

      views/          ← sub-collection (one doc per viewer)
        {user_id}/
          user_id     : str
          viewed_at   : Timestamp

Required Firestore indexes
(add in Firebase Console → Firestore → Indexes → Composite if missing):

  social_stories  author_id ASC, expires_at ASC, created_at DESC
  social_stories  expires_at ASC, created_at DESC
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta

from page_platform.firebase_client import get_firestore

logger         = logging.getLogger(__name__)
STORIES_COLL   = 'social_stories'


# ─────────────────────────────────────────────────────────────────────────────
#  Write
# ─────────────────────────────────────────────────────────────────────────────

def create_story(author, media_url: str, media_type: str,
                 content: str = '') -> dict:
    """
    Persist a new story document to Firestore.
    Returns the formatted story dict or {} on failure.
    """
    db = get_firestore()
    if db is None:
        logger.error('create_story: Firestore not available.')
        return {}

    story_id   = str(uuid.uuid4())
    now        = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(hours=24)

    doc = {
        'id':               story_id,
        'author_id':        str(author.id),
        'author_username':  author.username,
        'author_avatar':    _avatar(author),
        'content':          content,
        'media_url':        media_url,
        'media_type':       media_type,
        'view_count':       0,
        'created_at':       now,
        'expires_at':       expires_at,
    }

    try:
        db.collection(STORIES_COLL).document(story_id).set(doc)
        logger.info(f'Firestore story created: {story_id} by {author.username}')
        return _fmt_story(doc)
    except Exception as exc:
        logger.error(f'Firestore create_story error: {exc}')
        return {}


def delete_story(story_id: str, user_id: str) -> bool:
    """
    Delete a story and its views sub-collection.
    Returns True on success, False if not found or not the owner.
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        ref  = db.collection(STORIES_COLL).document(str(story_id))
        snap = ref.get()
        if not snap.exists:
            return False
        if snap.to_dict().get('author_id') != str(user_id):
            return False  # permission denied

        _delete_subcollection(ref.collection('views'))
        ref.delete()
        return True
    except Exception as exc:
        logger.error(f'Firestore delete_story error: {exc}')
        return False


def mark_viewed(story_id: str, viewer) -> dict:
    """
    Record that `viewer` has viewed the story.
    Atomically increments view_count on the story doc.
    Returns {'story_id', 'viewer_id', 'viewed_at', 'created': bool}.
    """
    db = get_firestore()
    if db is None:
        return {}

    now      = datetime.now(tz=timezone.utc)
    ref      = db.collection(STORIES_COLL).document(str(story_id))
    view_ref = ref.collection('views').document(str(viewer.id))

    try:
        existing = view_ref.get()
        is_new   = not existing.exists

        view_ref.set({
            'user_id':    str(viewer.id),
            'username':   viewer.username,
            'viewed_at':  now,
        })

        if is_new:
            from google.cloud.firestore_v1 import Increment
            ref.update({'view_count': Increment(1)})

        return {
            'story_id':  story_id,
            'viewer_id': str(viewer.id),
            'viewed_at': now.isoformat(),
            'created':   is_new,
        }
    except Exception as exc:
        logger.error(f'Firestore mark_viewed error: {exc}')
        return {}


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────

def get_story_feed(followed_user_ids: list, current_user_id: str,
                   limit: int = 50) -> list:
    """
    Return non-expired stories from `current_user_id` and followed users,
    newest first.

    Because Firestore doesn't support OR queries across multiple author_ids
    in a single call, we fetch in 'in' chunks (max 30 IDs) and merge client-side.
    """
    db = get_firestore()
    if db is None:
        return []

    now     = datetime.now(tz=timezone.utc)
    all_ids = list({str(uid) for uid in followed_user_ids} | {str(current_user_id)})
    chunks  = [all_ids[i:i+30] for i in range(0, len(all_ids), 30)]
    results = []

    try:
        for chunk in chunks:
            docs = (
                db.collection(STORIES_COLL)
                .where('author_id', 'in', chunk)
                .where('expires_at', '>', now)
                .order_by('expires_at')          # required before created_at
                .order_by('created_at', direction='DESCENDING')
                .limit(limit)
                .stream()
            )
            for doc in docs:
                d = doc.to_dict()
                d['id'] = doc.id
                results.append(_fmt_story(d))

        results.sort(key=lambda s: s.get('created_at') or '', reverse=True)
        return results[:limit]
    except Exception as exc:
        logger.error(f'Firestore get_story_feed error: {exc}')
        return []


def get_story(story_id: str) -> dict | None:
    """Fetch a single story by ID."""
    db = get_firestore()
    if db is None:
        return None

    try:
        snap = db.collection(STORIES_COLL).document(str(story_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        d['id'] = snap.id
        return _fmt_story(d)
    except Exception as exc:
        logger.error(f'Firestore get_story error: {exc}')
        return None


def get_story_viewers(story_id: str, limit: int = 100) -> list:
    """Return the list of viewers for a story (newest first)."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(STORIES_COLL)
            .document(str(story_id))
            .collection('views')
            .order_by('viewed_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [
            {
                'user_id':   d.to_dict().get('user_id', ''),
                'username':  d.to_dict().get('username', ''),
                'viewed_at': _ts(d.to_dict().get('viewed_at')),
            }
            for d in docs
        ]
    except Exception as exc:
        logger.error(f'Firestore get_story_viewers error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _avatar(user) -> str | None:
    # Prefer the new avatar_url TextField (base64 data URI or CDN URL)
    try:
        av = getattr(user, 'avatar_url', '')
        if av:
            return av
    except Exception:
        pass
    # Fall back to legacy ImageField
    try:
        return user.profile_image.url if user.profile_image else None
    except Exception:
        return None


def _ts(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    if hasattr(val, 'timestamp'):
        from datetime import datetime as _dt
        return _dt.fromtimestamp(val.timestamp(), tz=timezone.utc).isoformat()
    return str(val)


def _fmt_story(d: dict) -> dict:
    avatar = d.get('author_avatar')
    return {
        'id':               d.get('id', ''),
        'author': {
            'id':               d.get('author_id', ''),
            'username':         d.get('author_username', ''),
            'display_name':     d.get('author_username', ''),
            # Expose under both keys so the frontend can find it regardless
            # of which field it checks first (profile_image_url is preferred)
            'profile_image_url': avatar,
            'profile_image':    avatar,
        },
        'content':           d.get('content', ''),
        'media_url':         d.get('media_url', ''),
        'resolved_media_url': d.get('media_url', ''),   # alias the frontend expects
        'media_type':        d.get('media_type', 'image'),
        'view_count':        d.get('view_count', 0),
        'created_at':        _ts(d.get('created_at')),
        'expires_at':        _ts(d.get('expires_at')),
        'user_has_viewed':   d.get('user_has_viewed', False),
    }


def _delete_subcollection(col_ref, batch_size: int = 400):
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
