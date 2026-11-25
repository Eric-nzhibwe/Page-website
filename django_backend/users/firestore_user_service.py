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
    {firebase_uid}/                ← Firebase Auth uid (stable across SQL DB rebuilds)
      id                 : str      ← legacy SQL pk, kept for API compatibility
      firebase_uid       : str      ← same as the doc key, for reverse lookups
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

from google.cloud.firestore_v1 import FieldFilter
from page_platform.firebase_client import get_firestore

logger     = logging.getLogger(__name__)
COLLECTION = 'user_profiles'


# ─────────────────────────────────────────────────────────────────────────────
#  Doc-ID resolution
#  user_profiles docs are keyed by the Firebase UID (stable across SQL DB
#  rebuilds — Render Postgres expiry no longer orphans documents).
#  Legacy docs keyed by the old SQL integer id are still readable.
# ─────────────────────────────────────────────────────────────────────────────

def _uid_for_pk(pk) -> str:
    """Look up the Firebase UID for a SQL user pk (empty string if none)."""
    if pk is None:
        return ''
    try:
        from users.models import UserFirebaseProfile
        return (
            UserFirebaseProfile.objects
            .filter(user_id=pk)
            .values_list('firebase_uid', flat=True)
            .first()
        ) or ''
    except Exception:
        return ''


def resolve_doc_id(target) -> str:
    """
    Return the Firestore document id for `target`.

    Accepts a Django User, an EphemeralUser (users.firebase_token_auth),
    or a raw id (SQL pk or Firebase uid string).  Resolution order:
      1. object exposing `firebase_uid`        (EphemeralUser)
      2. object with a linked firebase_profile (Django User)
      3. object with a pk                     (DB lookup by pk)
      4. raw value, stringified               (assumed to be a uid)
    """
    # User-like objects
    if hasattr(target, 'firebase_uid'):
        uid = getattr(target, 'firebase_uid', '')
        if uid:
            return uid
    if hasattr(target, 'pk'):
        uid = _get_firebase_uid(target)
        if uid:
            return uid
        pk = getattr(target, 'pk', None)
        if pk is not None:
            return _uid_for_pk(pk) or str(pk)
    # Raw id — a uid, or a legacy numeric SQL id (resolve via DB)
    raw = str(target)
    if raw.isdigit():
        uid = _uid_for_pk(raw)
        if uid:
            return uid
    return raw


def _legacy_doc_id(target) -> str | None:
    """Old doc key (SQL integer id) if the target has one, else None."""
    pk = getattr(target, 'pk', None)
    if pk is None and hasattr(target, 'id'):
        try:
            pk = int(getattr(target, 'id'))
        except (TypeError, ValueError):
            return None
    return str(pk) if pk is not None else None


# ─────────────────────────────────────────────────────────────────────────────
#  Write — sync one user
# ─────────────────────────────────────────────────────────────────────────────

def sync_user(user, request=None) -> bool:
    """
    Write (create or overwrite) a user_profiles document for `user`,
    keyed by the user's Firebase UID.
    Safe to call on every User.save() — always a full overwrite, never
    a partial update, so the document stays consistent.
    Returns True on success.
    """
    db = get_firestore()
    if db is None:
        return False

    doc = _user_to_doc(user, request=request)
    try:
        db.collection(COLLECTION).document(resolve_doc_id(user)).set(doc)
        return True
    except Exception as exc:
        logger.error(f'Firestore sync_user error for {user.id}: {exc}')
        return False


def update_user_fields(user, fields: dict) -> bool:
    """
    Partial update — only the supplied fields are changed.
    Accepts a User object or a raw id (uid or legacy SQL id).
    Falls back to the legacy SQL-id document when the uid-keyed
    document does not exist yet.
    """
    db = get_firestore()
    if db is None:
        return False

    fields['updated_at'] = datetime.now(tz=timezone.utc)
    key = resolve_doc_id(user)
    try:
        try:
            db.collection(COLLECTION).document(key).update(fields)
            return True
        except Exception:
            # Fall back to a legacy SQL-id keyed doc (pre-uid-keying)
            legacy = _legacy_doc_id(user)
            if legacy and legacy != key:
                db.collection(COLLECTION).document(legacy).update(fields)
                return True
            raise
    except Exception as exc:
        logger.error(f'Firestore update_user_fields error for {key}: {exc}')
        return False


def increment_user_counter(user, field: str, delta: int = 1) -> bool:
    """Atomically increment a numeric field (prestige_points, total_submissions…)."""
    db = get_firestore()
    if db is None:
        return False

    key = resolve_doc_id(user)
    try:
        from google.cloud.firestore_v1 import Increment
        db.collection(COLLECTION).document(key).update({
            field:        Increment(delta),
            'updated_at': datetime.now(tz=timezone.utc),
        })
        return True
    except Exception as exc:
        logger.error(f'Firestore increment_user_counter ({field}) error for {key}: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────

def get_user_profile(user_id: str) -> dict | None:
    """
    Fetch a public user profile.
    `user_id` may be a Firebase uid (current keying) or a legacy SQL id —
    both are tried, since the doc key is whatever was passed.
    """
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
            .where(filter=FieldFilter('username', '>=', q))
            .where(filter=FieldFilter('username', '<=', q + '\uf8ff'))
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            if exclude_user_id:
                excl = str(exclude_user_id)
                # Match by doc key (uid), embedded SQL id, or uid field
                if excl in (doc.id, d.get('id', ''), d.get('firebase_uid', '')):
                    continue
            results.append(_fmt(d))
        return results
    except Exception as exc:
        logger.error(f'Firestore search_users error: {exc}')
        return []


def get_users_by_ids(user_ids: list) -> list:
    """
    Batch-fetch multiple user profiles by ID list.
    Each id may be a Firebase uid or a legacy SQL id; a SQL id is
    resolved to its uid when a DB is available.
    """
    db = get_firestore()
    if db is None:
        return []

    results = []
    try:
        for _id in user_ids:
            key = resolve_doc_id(_id)
            snap = db.collection(COLLECTION).document(key).get()
            if not snap.exists and key != str(_id):
                snap = db.collection(COLLECTION).document(str(_id)).get()
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
        ref = db.collection(COLLECTION).document(resolve_doc_id(user))
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

def _get_firebase_uid(user) -> str:
    """Return the Firebase UID for a user if linked, else empty string."""
    try:
        return user.firebase_profile.firebase_uid
    except Exception:
        return ''


def _user_to_doc(user, request=None) -> dict:
    """Build the Firestore document dict from a Django User instance."""
    # Profile image URL — avatar_url (base64/CDN) takes priority over the
    # legacy ImageField which can 404 on Render's ephemeral filesystem.
    profile_image_url = None
    try:
        # avatar_url is set by the upload endpoint — always a valid data URI or CDN URL
        av = getattr(user, 'avatar_url', '')
        if av:
            profile_image_url = av
        elif user.profile_image and user.profile_image.storage.exists(user.profile_image.name):
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
        'username_lower':        user.username.lower(),   # for case-insensitive Firestore lookups
        'display_name':          user.display_name or user.username,
        'bio':                   user.bio or '',
        'profile_image_url':     profile_image_url,
        'avatar_url':            getattr(user, 'avatar_url', '') or '',  # preserve base64 data URI across syncs
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
        'firebase_uid':          _get_firebase_uid(user),   # for Firestore-only lookups
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
    avatar = d.get('profile_image_url')
    return {
        'id':                    d.get('id', ''),
        'username':              d.get('username', ''),
        'display_name':          d.get('display_name', ''),
        'bio':                   d.get('bio', ''),
        # Both keys so every frontend renderer finds the avatar
        'profile_image_url':     avatar,
        'profile_image':         avatar,
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
