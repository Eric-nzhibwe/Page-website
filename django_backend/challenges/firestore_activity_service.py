"""
Firestore Challenge Activity Service — Phase 2
================================================
Drop-in replacement for the PostgreSQL-backed ChallengeActivity queries.
Used by challenges/views.py and challenges/signals.py when
settings.FIRESTORE_COLLECTIONS['challenge_activities'] is True.

Firestore collection layout
---------------------------
  challenge_activities/
    {doc_id}/
      challenge_id    : str   — UUID of the challenge
      challenge_title : str   — denormalised for fast reads
      user_id         : str   — UUID of the acting user
      username        : str   — denormalised
      activity_type   : str   — submission | score_update | milestone | leaderboard_change
      description     : str
      metadata        : dict  — arbitrary extra data (scores, counts, etc.)
      created_at      : Timestamp

Required Firestore composite indexes
(create in Firebase Console → Firestore → Indexes → Composite):

  Collection: challenge_activities
  ├── challenge_id ASC, created_at DESC
  └── created_at DESC                    (for global feed)
"""

import logging
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger    = logging.getLogger(__name__)
COLLECTION = 'challenge_activities'


# ─────────────────────────────────────────────────────────────────────────────
#  Write
# ─────────────────────────────────────────────────────────────────────────────

def create_activity(challenge, user, activity_type, description, metadata=None):
    """
    Write a new activity document to Firestore.
    Returns the written document dict (with id set), or None on failure.

    Parameters mirror ChallengeActivity model fields so callers need
    no changes when switching from ORM to Firestore.
    """
    db = get_firestore()
    if db is None:
        logger.warning('create_activity called but Firestore is not available.')
        return None

    doc = {
        'challenge_id':    str(challenge.id),
        'challenge_title': challenge.title,
        'user_id':         str(user.id),
        'username':        user.username,
        'activity_type':   activity_type,
        'description':     description,
        'metadata':        metadata or {},
        'created_at':      datetime.now(tz=timezone.utc),
    }

    try:
        ref     = db.collection(COLLECTION).add(doc)
        doc_ref = ref[1] if isinstance(ref, tuple) else ref
        doc['id'] = doc_ref.id
        return doc
    except Exception as exc:
        logger.error(f'Firestore create_activity error: {exc}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Read — per-challenge feed
# ─────────────────────────────────────────────────────────────────────────────

def get_challenge_activity(challenge_id, limit=50):
    """
    Return the most recent `limit` activity documents for a challenge.
    Returns a list of plain dicts matching the REST API shape.
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(COLLECTION)
            .where('challenge_id', '==', str(challenge_id))
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_format(d) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_challenge_activity error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Read — global feed
# ─────────────────────────────────────────────────────────────────────────────

def get_global_activity(limit=100):
    """
    Return the most recent `limit` activity documents across all challenges.
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(COLLECTION)
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_format(d) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_global_activity error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(queryset):
    """
    One-time migration: copy existing ChallengeActivity rows from PostgreSQL
    into Firestore.  Call from a management command, not from a view.

    Usage:
        from challenges.models import ChallengeActivity
        from challenges.firestore_activity_service import migrate_from_postgres
        migrate_from_postgres(
            ChallengeActivity.objects.select_related('challenge', 'user')
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_from_postgres (activities): Firestore not available.')
        return 0

    BATCH_SIZE = 400
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for a in queryset.iterator():
        doc = {
            'challenge_id':    str(a.challenge_id),
            'challenge_title': a.challenge.title,
            'user_id':         str(a.user_id),
            'username':        a.user.username,
            'activity_type':   a.activity_type,
            'description':     a.description,
            'metadata':        a.metadata or {},
            'created_at':      a.created_at,
            '_pg_id':          a.id,
        }
        ref = db.collection(COLLECTION).document()
        batch.set(ref, doc)
        count    += 1
        migrated += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0
            logger.info(f'migrate activities: {migrated} written…')

    if count > 0:
        batch.commit()

    logger.info(f'migrate activities: done — {migrated} total.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _format(doc) -> dict:
    """Normalise a Firestore document to the REST API shape."""
    d = doc.to_dict()
    d['id'] = doc.id

    created = d.get('created_at')
    if hasattr(created, 'isoformat'):
        created = created.isoformat()

    return {
        'id':              d.get('id', ''),
        'challenge':       d.get('challenge_id', ''),
        'challenge_title': d.get('challenge_title', ''),
        'user': {
            'username':     d.get('username', ''),
            'display_name': d.get('username', ''),
            'profile_image': None,
        },
        'activity_type':   d.get('activity_type', 'submission'),
        'description':     d.get('description', ''),
        'metadata':        d.get('metadata', {}),
        'created_at':      created,
    }
