"""
Firestore User Profile Service — Phase 8
==========================================
Mirrors public user profile data from PostgreSQL into Firestore.

⚠️  SECURITY BOUNDARY — NEVER STORED IN FIRESTORE:
    • passwords (hashed or plain)
    • auth tokens
    • OTP codes / sessions
    • email addresses (private)
    • phone numbers (private)
    • failed_login_attempts / locked_until
    • last_login_ip
    • date_of_birth (private)

Everything below is either already public in the API or needed by other
Firestore collections (notifications, social posts, challenges) to display
the user's name, avatar, and tier without a cross-collection join.

Firestore collection layout
---------------------------
  user_profiles/
    {user_id}/                     ← UUID string (same as Postgres PK)
      id                 : str
      username           : str
      display_name       : str
      bio                : str
      profile_image_url  : str | null
      access_tier        : str
      prestige_points    : int
      level              : int
      power_rank         : str
      current_streak     : int
      total_submissions  : int
      successful_submissions : int
      tournament_wins    : int
      total_earnings     : float
      is_verified        : bool
      verification_level : int
      location           : str
      website            : str
      social_connections : dict
      preferences        : dict       ← non-sensitive prefs (theme, language…)
      followers_count    : int        ← denormalised for cheap reads
      following_count    : int
      created_at         : Timestamp
      updated_at         : Timestamp

Required Firestore indexes:
  user_profiles → prestige_points DESC   (leaderboard — auto single-field)
  user_profiles → access_tier ASC, prestige_points DESC
"""

import logging
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger     = logging.getLogger(__name__)
COLLECTION = 'user_profiles'


# ─────────────────────────────────────────────────────────────────────────────
#  Write — sync one user
# ─────────────────────────────────────────────────────────────────────────────

def sync_user(user, request=None) -> bool:
    """
    Write (create or overwrite) a user_profiles document for `user`.
    Safe to call on every User.save() — always a full overwrite, never
    a partial update, so the document stays consistent.
    Returns True on success.
    """
    db = get_firestore()
    if db is None:
        return False

    doc = _user_to_doc(user, request=request)
    try:
        db.collection(COLLECTION).document(str(user.id)).set(doc)
        return True
    except Exception as exc:
        logger.error(f'Firestore sync_user error for {user.id}: {exc}')
        return False


def update_user_fields(user_id: str, fields: dict) -> bool:
    """
    Partial update — only the supplied fields are changed.
    Use this for high-frequency counter increments (prestige, streak, etc.)
    to avoid a full document read-write cycle.
    """
    db = get_firestore()
    if db is None:
        return False

    fields['updated_at'] = datetime.now(tz=timezone.utc)
    try:
        db.collection(COLLECTION).document(str(user_id)).update(fields)
        return True
    except Exception as exc:
        logger.error(f'Firestore update_user_fields error for {user_id}: {exc}')
        return False


def increment_user_counter(user_id: str, field: str, delta: int = 1) -> bool:
    """Atomically increment a numeric field (prestige_points, total_submissions…)."""
    db = get_firestore()
    if db is None:
        return False

    try:
        from google.cloud.firestore_v1 import Increment
        db.collection(COLLECTION).document(str(user_id)).update({
            field:        Increment(delta),
            'updated_at': datetime.now(tz=timezone.utc),
        })
        return True
    except Exception as exc:
        logger.error(f'Firestore increment_user_counter ({field}) error: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────

def get_user_profile(user_id: str) -> dict | None:
    """Fetch a public user profile by ID."""
    db = get_firestore()
    if db is None:
        return None

    try:
        snap = db.collection(COLLECTION).document(str(user_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        d['id'] = snap.id
        return _fmt(d)
    except Exception as exc:
        logger.error(f'Firestore get_user_profile error: {exc}')
        return None


def get_leaderboard(limit: int = 50) -> list:
    """Return users sorted by prestige_points descending."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(COLLECTION)
            .order_by('prestige_points', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_fmt(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_leaderboard error: {exc}')
        return []


def search_users(query: str, exclude_user_id: str = None,
                 limit: int = 20) -> list:
    """
    Search by username prefix.
    Firestore doesn't support full-text search so we use a
    range query on username: >= query AND <= query + '\uf8ff'.
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        q = query.lower()
        docs = (
            db.collection(COLLECTION)
            .where('username', '>=', q)
            .where('username', '<=', q + '\uf8ff')
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            if exclude_user_id and d['id'] == str(exclude_user_id):
                continue
            results.append(_fmt(d))
        return results
    except Exception as exc:
        logger.error(f'Firestore search_users error: {exc}')
        return []


def get_users_by_ids(user_ids: list) -> list:
    """Batch-fetch multiple user profiles by ID list."""
    db = get_firestore()
    if db is None:
        return []

    results = []
    try:
        for uid in user_ids:
            snap = db.collection(COLLECTION).document(str(uid)).get()
            if snap.exists:
                d = snap.to_dict()
                d['id'] = snap.id
                results.append(_fmt(d))
    except Exception as exc:
        logger.error(f'Firestore get_users_by_ids error: {exc}')
    return results


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(queryset):
    """
    One-time migration: copy User rows from PostgreSQL to Firestore.
    Only public profile fields are written — credentials are never touched.

    Usage:
        from users.models import User
        from users.firestore_user_service import migrate_from_postgres
        migrate_from_postgres(User.objects.filter(is_active=True))
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate users: Firestore not available.')
        return 0

    BATCH_SIZE = 400
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for user in queryset.iterator():
        doc = _user_to_doc(user)
        ref = db.collection(COLLECTION).document(str(user.id))
        batch.set(ref, doc)
        count    += 1
        migrated += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0
            logger.info(f'migrate users: {migrated} written…')

    if count > 0:
        batch.commit()

    logger.info(f'migrate users: done — {migrated} profiles written.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _user_to_doc(user, request=None) -> dict:
    """Build the Firestore document dict from a Django User instance."""
    # Profile image URL — gracefully handle missing files on Render
    profile_image_url = None
    try:
        if user.profile_image and user.profile_image.storage.exists(user.profile_image.name):
            if request:
                profile_image_url = request.build_absolute_uri(user.profile_image.url)
            else:
                profile_image_url = user.profile_image.url
    except Exception:
        pass

    # Follower / following counts — catch if relations not loaded
    try:
        followers_count = user.followers.count()
    except Exception:
        followers_count = 0
    try:
        following_count = user.following.count()
    except Exception:
        following_count = 0

    # Strip sensitive keys from preferences
    safe_prefs = {k: v for k, v in (user.preferences or {}).items()
                  if k not in ('payment_method', 'card_last4', 'bank_account')}

    now = datetime.now(tz=timezone.utc)

    return {
        'id':                    str(user.id),
        'username':              user.username,
        'display_name':          user.display_name or user.username,
        'bio':                   user.bio or '',
        'profile_image_url':     profile_image_url,
        'access_tier':           user.access_tier,
        'prestige_points':       user.prestige_points,
        'level':                 user.level,
        'power_rank':            user.power_rank,
        'current_streak':        user.current_streak,
        'total_submissions':     user.total_submissions,
        'successful_submissions': user.successful_submissions,
        'tournament_wins':       user.tournament_wins,
        'total_earnings':        float(user.total_earnings),
        'is_verified':           user.is_verified,
        'verification_level':    user.verification_level,
        'location':              user.location or '',
        'website':               user.website or '',
        'social_connections':    user.social_connections or {},
        'preferences':           safe_prefs,
        'followers_count':       followers_count,
        'following_count':       following_count,
        'created_at':            user.created_at if hasattr(user, 'created_at') and user.created_at else now,
        'updated_at':            now,
    }


def _ts(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    if hasattr(val, 'timestamp'):
        return datetime.fromtimestamp(val.timestamp(), tz=timezone.utc).isoformat()
    return str(val)


def _fmt(d: dict) -> dict:
    """Normalise a Firestore document to the REST API shape."""
    return {
        'id':                    d.get('id', ''),
        'username':              d.get('username', ''),
        'display_name':          d.get('display_name', ''),
        'bio':                   d.get('bio', ''),
        'profile_image_url':     d.get('profile_image_url'),
        'access_tier':           d.get('access_tier', 'Bronze'),
        'prestige_points':       d.get('prestige_points', 0),
        'level':                 d.get('level', 1),
        'power_rank':            d.get('power_rank', 'Novice'),
        'current_streak':        d.get('current_streak', 0),
        'total_submissions':     d.get('total_submissions', 0),
        'successful_submissions': d.get('successful_submissions', 0),
        'tournament_wins':       d.get('tournament_wins', 0),
        'total_earnings':        d.get('total_earnings', 0.0),
        'is_verified':           d.get('is_verified', False),
        'verification_level':    d.get('verification_level', 0),
        'location':              d.get('location', ''),
        'website':               d.get('website', ''),
        'social_connections':    d.get('social_connections', {}),
        'followers_count':       d.get('followers_count', 0),
        'following_count':       d.get('following_count', 0),
        'created_at':            _ts(d.get('created_at')),
        'updated_at':            _ts(d.get('updated_at')),
    }
