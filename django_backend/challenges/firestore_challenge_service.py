"""
Firestore Challenge Service — Phase 4
=======================================
Drop-in replacement for the PostgreSQL-backed Challenge queries.
Used by challenges/views.py when
settings.FIRESTORE_COLLECTIONS['challenges'] is True.

Firestore collection layout
---------------------------
  challenges/
    {challenge_id}/           ← UUID string (same as Postgres PK)
      id                : str
      title             : str
      description       : str
      image_url         : str          ← full URL; gated in _apply_image_gate()
      difficulty        : str          — easy|medium|hard|expert
      challenge_type    : str          — text_interpretation|image_interpretation
      hidden_points     : list         — image interp answer key
      prize_amount      : float
      entry_fee         : float
      time_limit        : int          — minutes
      min_word_count    : int
      max_word_count    : int
      submission_rules  : list
      creativity_weight : int
      relevance_weight  : int
      detail_weight     : int
      min_points        : int
      max_points        : int
      status            : str          — draft|active|paused|ended
      is_featured       : bool
      view_count        : int
      submission_count  : int
      created_by_id     : str          — user UUID
      created_by_username : str        — denormalised
      starts_at         : Timestamp
      ends_at           : Timestamp
      created_at        : Timestamp
      updated_at        : Timestamp

Required Firestore composite indexes
(Firebase Console → Firestore → Indexes → Composite):

  challenges
  ├── status ASC, starts_at ASC, ends_at ASC, created_at DESC  (active feed)
  ├── status ASC, created_at DESC                               (my_challenges / list)
  ├── created_by_id ASC, created_at DESC                        (creator view)
  └── is_featured ASC, status ASC, created_at DESC              (featured)
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from artx_platform.firebase_client import get_firestore

logger     = logging.getLogger(__name__)
COLLECTION = 'challenges'
_MIN_DEPOSIT = 10   # ZMW — must match serializers.py constant


# ─────────────────────────────────────────────────────────────────────────────
#  Write — create / update / status change
# ─────────────────────────────────────────────────────────────────────────────

def create_challenge(validated_data: dict, image_url: str, user) -> Optional[dict]:
    """
    Save a new challenge document to Firestore.
    `validated_data` comes from ChallengeCreateSerializer.validated_data
    (already cleaned, image popped out by the serializer).
    Returns the full challenge dict with computed fields, or None on failure.
    """
    db = get_firestore()
    if db is None:
        return None

    challenge_id = str(uuid.uuid4())
    now          = datetime.now(tz=timezone.utc)

    doc = {
        'id':                  challenge_id,
        'title':               validated_data['title'],
        'description':         validated_data['description'],
        'image_url':           image_url,
        'difficulty':          validated_data.get('difficulty', 'medium'),
        'challenge_type':      validated_data.get('challenge_type', 'text_interpretation'),
        'hidden_points':       validated_data.get('hidden_points', []),
        'prize_amount':        float(validated_data.get('prize_amount', 0)),
        'entry_fee':           float(validated_data.get('entry_fee', 0)),
        'time_limit':          validated_data.get('time_limit', 20),
        'min_word_count':      validated_data.get('min_word_count', 50),
        'max_word_count':      validated_data.get('max_word_count', 500),
        'submission_rules':    validated_data.get('submission_rules', []),
        'creativity_weight':   validated_data.get('creativity_weight', 40),
        'relevance_weight':    validated_data.get('relevance_weight', 35),
        'detail_weight':       validated_data.get('detail_weight', 25),
        'min_points':          validated_data.get('min_points', 10),
        'max_points':          validated_data.get('max_points', 50),
        'status':              'draft',
        'is_featured':         False,
        'view_count':          0,
        'submission_count':    0,
        'created_by_id':       str(user.id),
        'created_by_username': user.username,
        'starts_at':           validated_data.get('starts_at', now),
        'ends_at':             validated_data.get('ends_at', now + timedelta(days=7)),
        'created_at':          now,
        'updated_at':          now,
    }

    try:
        db.collection(COLLECTION).document(challenge_id).set(doc)
        return _add_computed(doc)
    except Exception as exc:
        logger.error(f'Firestore create_challenge error: {exc}')
        return None


def get_challenge(challenge_id: str, user=None) -> Optional[dict]:
    """Fetch a single challenge.  Applies image gating for image_interpretation."""
    db = get_firestore()
    if db is None:
        return None

    try:
        snap = db.collection(COLLECTION).document(str(challenge_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        d['id'] = snap.id
        _add_computed(d)
        _apply_image_gate(d, user)
        return d
    except Exception as exc:
        logger.error(f'Firestore get_challenge error: {exc}')
        return None


def update_challenge_status(challenge_id: str, new_status: str,
                             extra_fields: dict = None) -> Optional[dict]:
    """
    Change a challenge's status (draft→active, active→paused, etc.)
    and optionally update extra fields (e.g. starts_at).
    Returns the updated challenge dict or None on failure.
    """
    db = get_firestore()
    if db is None:
        return None

    update = {'status': new_status, 'updated_at': datetime.now(tz=timezone.utc)}
    if extra_fields:
        update.update(extra_fields)

    try:
        ref = db.collection(COLLECTION).document(str(challenge_id))
        ref.update(update)
        snap = ref.get()
        d = snap.to_dict()
        d['id'] = snap.id
        return _add_computed(d)
    except Exception as exc:
        logger.error(f'Firestore update_challenge_status error: {exc}')
        return None


def increment_submission_count(challenge_id: str):
    """Atomically increment submission_count by 1."""
    db = get_firestore()
    if db is None:
        return

    try:
        from google.cloud.firestore_v1 import ArrayUnion, Increment
        db.collection(COLLECTION).document(str(challenge_id)).update({
            'submission_count': Increment(1),
            'updated_at':       datetime.now(tz=timezone.utc),
        })
    except Exception as exc:
        logger.error(f'Firestore increment_submission_count error: {exc}')


# ─────────────────────────────────────────────────────────────────────────────
#  Read — list queries
# ─────────────────────────────────────────────────────────────────────────────

def get_active_challenges(user=None, limit=200) -> list:
    """Return all currently active challenges."""
    db = get_firestore()
    if db is None:
        return []

    now = datetime.now(tz=timezone.utc)
    try:
        docs = (
            db.collection(COLLECTION)
            .where('status', '==', 'active')
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            _add_computed(d)
            # Filter client-side for ends_at (Firestore can't do range + equality
            # on different fields without a composite index on all three)
            ends = _to_dt(d.get('ends_at'))
            starts = _to_dt(d.get('starts_at'))
            if ends and ends > now and starts and starts <= now:
                _apply_image_gate(d, user)
                results.append(d)
        return results
    except Exception as exc:
        logger.error(f'Firestore get_active_challenges error: {exc}')
        return []


def get_featured_challenges(user=None, limit=20) -> list:
    """Return active featured challenges."""
    db = get_firestore()
    if db is None:
        return []

    now = datetime.now(tz=timezone.utc)
    try:
        docs = (
            db.collection(COLLECTION)
            .where('is_featured', '==', True)
            .where('status', '==', 'active')
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            _add_computed(d)
            ends = _to_dt(d.get('ends_at'))
            if ends and ends > now:
                _apply_image_gate(d, user)
                results.append(d)
        return results
    except Exception as exc:
        logger.error(f'Firestore get_featured_challenges error: {exc}')
        return []


def get_challenges_by_creator(user_id: str, user=None) -> list:
    """Return all challenges created by a user (any status)."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(COLLECTION)
            .where('created_by_id', '==', str(user_id))
            .order_by('created_at', direction='DESCENDING')
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            _add_computed(d)
            _apply_image_gate(d, user)
            results.append(d)
        return results
    except Exception as exc:
        logger.error(f'Firestore get_challenges_by_creator error: {exc}')
        return []


def get_following_challenges(followed_user_ids: list, user=None) -> list:
    """Return active challenges created by users in followed_user_ids."""
    if not followed_user_ids:
        return []

    db = get_firestore()
    if db is None:
        return []

    now = datetime.now(tz=timezone.utc)
    # Firestore 'in' clause supports up to 30 values — chunk if needed
    results = []
    chunks  = [followed_user_ids[i:i+30] for i in range(0, len(followed_user_ids), 30)]

    try:
        for chunk in chunks:
            docs = (
                db.collection(COLLECTION)
                .where('created_by_id', 'in', [str(uid) for uid in chunk])
                .where('status', '==', 'active')
                .order_by('created_at', direction='DESCENDING')
                .stream()
            )
            for doc in docs:
                d = doc.to_dict()
                d['id'] = doc.id
                _add_computed(d)
                ends   = _to_dt(d.get('ends_at'))
                starts = _to_dt(d.get('starts_at'))
                if ends and ends > now and starts and starts <= now:
                    _apply_image_gate(d, user)
                    results.append(d)
        return results
    except Exception as exc:
        logger.error(f'Firestore get_following_challenges error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(queryset):
    """
    One-time migration: copy Challenge rows from PostgreSQL into Firestore.

    Usage:
        from challenges.models import Challenge
        from challenges.firestore_challenge_service import migrate_from_postgres
        migrate_from_postgres(
            Challenge.objects.select_related('created_by').all()
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_from_postgres (challenges): Firestore not available.')
        return 0

    BATCH_SIZE = 400
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for c in queryset.iterator():
        doc = {
            'id':                  str(c.id),
            'title':               c.title,
            'description':         c.description,
            'image_url':           c.image_url,
            'difficulty':          c.difficulty,
            'challenge_type':      c.challenge_type,
            'hidden_points':       c.hidden_points or [],
            'prize_amount':        float(c.prize_amount),
            'entry_fee':           float(c.entry_fee),
            'time_limit':          c.time_limit,
            'min_word_count':      c.min_word_count,
            'max_word_count':      c.max_word_count,
            'submission_rules':    c.submission_rules or [],
            'creativity_weight':   c.creativity_weight,
            'relevance_weight':    c.relevance_weight,
            'detail_weight':       c.detail_weight,
            'min_points':          c.min_points,
            'max_points':          c.max_points,
            'status':              c.status,
            'is_featured':         c.is_featured,
            'view_count':          c.view_count,
            'submission_count':    c.submission_count,
            'created_by_id':       str(c.created_by_id) if c.created_by_id else None,
            'created_by_username': c.created_by.username if c.created_by else None,
            'starts_at':           c.starts_at,
            'ends_at':             c.ends_at,
            'created_at':          c.created_at,
            'updated_at':          c.updated_at,
            '_pg_id':              str(c.id),
        }
        ref = db.collection(COLLECTION).document(str(c.id))
        batch.set(ref, doc)
        count    += 1
        migrated += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0
            logger.info(f'migrate challenges: {migrated} written…')

    if count > 0:
        batch.commit()

    logger.info(f'migrate challenges: done — {migrated} total.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_dt(val) -> Optional[datetime]:
    """Coerce a Firestore Timestamp, datetime, or None to a tz-aware datetime."""
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    # Firestore DatetimeWithNanoseconds or google.protobuf.timestamp
    if hasattr(val, 'timestamp'):
        return datetime.fromtimestamp(val.timestamp(), tz=timezone.utc)
    return None


def _ts(val) -> Optional[str]:
    """Convert datetime / Firestore Timestamp to ISO string."""
    dt = _to_dt(val)
    return dt.isoformat() if dt else None


def _add_computed(d: dict) -> dict:
    """Add is_active, time_remaining, has_started, has_ended in-place."""
    now    = datetime.now(tz=timezone.utc)
    ends   = _to_dt(d.get('ends_at'))
    starts = _to_dt(d.get('starts_at'))
    active = d.get('status') == 'active'

    d['is_active']      = bool(active and starts and ends and starts <= now <= ends)
    d['has_started']    = bool(starts and now >= starts)
    d['has_ended']      = bool(ends and now > ends)
    d['time_remaining'] = max(0, int((ends - now).total_seconds())) if ends else 0

    # Normalise timestamps to ISO strings for JSON serialisation
    d['starts_at']   = _ts(d.get('starts_at'))
    d['ends_at']     = _ts(d.get('ends_at'))
    d['created_at']  = _ts(d.get('created_at'))
    d['updated_at']  = _ts(d.get('updated_at'))

    # Ensure numeric fields are the right type
    d['prize_amount'] = float(d.get('prize_amount', 0))
    d['entry_fee']    = float(d.get('entry_fee', 0))

    # Convenience fields expected by the frontend / serializer
    d.setdefault('user_has_submitted',     False)
    d.setdefault('user_has_img_submitted', False)
    d.setdefault('created_by_username',    d.get('created_by_username', ''))

    return d


def _apply_image_gate(d: dict, user) -> None:
    """
    For image_interpretation challenges, hide the image_url unless the user
    has ≥ K10 in their wallet.  Mirrors the behaviour in ChallengeSerializer.
    Modifies the dict in-place.
    """
    if d.get('challenge_type') != 'image_interpretation':
        return

    if user is None or not getattr(user, 'is_authenticated', False):
        d['image_url'] = None
        return

    try:
        balance = user.wallet.available_balance
        if balance < _MIN_DEPOSIT:
            d['image_url'] = None
    except Exception:
        d['image_url'] = None
