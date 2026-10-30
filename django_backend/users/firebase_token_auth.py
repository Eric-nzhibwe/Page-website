"""
Firebase Token Authentication for DRF
======================================
Allows API requests to authenticate using a Firebase ID token sent in the
Authorization header:  ``Authorization: FirebaseToken <id_token>``

This class verifies the token via the Firebase Admin SDK and returns a
Django User instance.  When the database is unavailable (e.g. Render free
tier SQLite on a fresh deploy, or the old Postgres was suspended) it falls
back to an ``EphemeralUser`` populated from the decoded Firebase token and,
optionally, the user's Firestore profile document.

This makes the entire API usable with Firebase Auth as the sole
authentication mechanism — no PostgreSQL required.
"""

import logging

from rest_framework.authentication import BaseAuthentication

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  Ephemeral user — used when the Django DB is unavailable
# ─────────────────────────────────────────────────────────────────────────────

class _EmptyRelation:
    """Mimics a Django reverse relation for serializer .count() calls."""

    def count(self):
        return 0

    def all(self):
        return []


class EphemeralUser:
    """
    Lightweight user object for Firebase-authenticated requests when the
    Django database is unavailable.

    Implements the minimum interface that DRF views and serializers expect
    so that read-only endpoints (profile, leaderboard, challenges, etc.)
    keep working even with no database behind them.
    """

    # Django / DRF flags
    is_authenticated = True
    is_active = True
    is_anonymous = False
    is_staff = False
    is_superuser = False

    # Gaming stats — safe defaults
    prestige_points = 0
    level = 1
    power_rank = "Novice"
    access_tier = "Bronze"
    current_streak = 0
    total_submissions = 0
    successful_submissions = 0
    tournament_wins = 0
    total_earnings = 0.0
    verification_level = 0
    is_verified = False

    # Profile fields — safe defaults
    bio = ""
    phone = ""
    location = ""
    website = ""
    profile_image = None
    avatar_url = ""
    preferences = {}
    social_connections = {}
    date_of_birth = None
    password_changed_at = None
    last_login_ip = None
    failed_login_attempts = 0
    locked_until = None
    created_at = None
    updated_at = None
    last_login_date = None

    # Relations — empty so serializers don't crash
    followers = _EmptyRelation()
    following = _EmptyRelation()

    def __init__(self, decoded_token, firestore_profile=None):
        self.firebase_uid = decoded_token.get("uid", "")
        self.id = self.firebase_uid
        self.pk = self.firebase_uid
        self.email = decoded_token.get("email", "")
        name = decoded_token.get("name", "")
        self.username = name or (self.email.split("@")[0] if self.email else self.firebase_uid[:12])
        self.display_name = name or self.username
        self.email_verified = decoded_token.get("email_verified", False)

        # Override with Firestore profile if available
        if firestore_profile:
            _safe_keys = [
                "prestige_points", "level", "power_rank", "access_tier",
                "current_streak", "total_submissions", "successful_submissions",
                "tournament_wins", "total_earnings", "is_verified",
                "verification_level", "bio", "location", "website",
                "social_connections", "preferences", "avatar_url",
            ]
            for key in _safe_keys:
                val = firestore_profile.get(key)
                if val is not None:
                    setattr(self, key, val)

            # These need special handling (can't use setattr blindly)
            if firestore_profile.get("id"):
                self.id = firestore_profile["id"]
                self.pk = self.id
            if firestore_profile.get("username"):
                self.username = firestore_profile["username"]
            if firestore_profile.get("display_name"):
                self.display_name = firestore_profile["display_name"]
            if firestore_profile.get("profile_image_url"):
                self.avatar_url = firestore_profile["profile_image_url"]

    # ── Password helpers (no-op — auth is Firebase) ────────────────────────
    def check_password(self, raw_password):
        return False

    def has_usable_password(self):
        return False

    def set_password(self, raw_password):
        pass

    # ── Computed properties ───────────────────────────────────────────────
    @property
    def success_rate(self):
        if self.total_submissions == 0:
            return 0
        return round((self.successful_submissions / self.total_submissions) * 100, 1)

    def get_social_connections(self):
        return self.social_connections or {}

    def save(self, *args, **kwargs):
        raise NotImplementedError("Cannot save an ephemeral user to the database")

    def __str__(self):
        return f"{self.username} (Firebase: {self.firebase_uid})"


# ─────────────────────────────────────────────────────────────────────────────
#  DRF Authentication class
# ─────────────────────────────────────────────────────────────────────────────

class FirebaseTokenAuthentication(BaseAuthentication):
    """
    DRF authentication class that accepts a Firebase ID token.

    Header format::

        Authorization: FirebaseToken <firebase_id_token>

    Flow
    ----
    1.  Extract the Firebase ID token from the ``Authorization`` header.
    2.  Verify it via ``firebase_admin.auth.verify_id_token()``.
    3.  Find or create a Django User in the database (best-effort).
    4.  If the DB is unavailable, return an ``EphemeralUser`` built from
        the decoded token and the user's Firestore profile.

    When Firebase is not configured, returns ``None`` so DRF falls through
    to the next authentication class (TokenAuthentication, etc.).
    """

    keyword = "FirebaseToken"

    def authenticate(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        if not auth_header.startswith(f"{self.keyword} "):
            return None

        firebase_token = auth_header[len(self.keyword) + 1:].strip()
        if not firebase_token:
            return None

        # ── 1. Check Firebase is configured ────────────────────────────────
        try:
            from page_platform.firebase_client import firebase_enabled
            if not firebase_enabled():
                return None
        except Exception:
            return None

        # ── 2. Verify the Firebase ID token ───────────────────────────────
        try:
            import firebase_admin.auth as fb_auth
            decoded = fb_auth.verify_id_token(firebase_token)
        except Exception as exc:
            logger.warning("FirebaseToken auth: token verification failed: %s", exc)
            return None

        # ── 3. Try to find/create a Django User in the database ────────────
        try:
            from users.firebase_auth_backend import FirebaseAuthenticationBackend
            backend = FirebaseAuthenticationBackend()
            user = backend._get_or_create_user(decoded)
            if user is not None:
                return (user, decoded)
        except Exception as exc:
            logger.warning(
                "FirebaseToken auth: DB unavailable, using ephemeral user: %s",
                exc,
            )

        # ── 4. Fallback: ephemeral user from decoded token + Firestore ────
        firestore_profile = self._get_firestore_profile(decoded)
        user = EphemeralUser(decoded, firestore_profile)
        return (user, decoded)

    def authenticate_header(self, request):
        return self.keyword

    # ─────────────────────────────────────────────────────────────────────
    #  Internal helpers
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _get_firestore_profile(decoded_token):
        """Best-effort: fetch the user's Firestore profile document."""
        try:
            from page_platform.firebase_client import get_firestore
            from google.cloud.firestore_v1 import FieldFilter

            db = get_firestore()
            if db is None:
                return None

            firebase_uid = decoded_token.get("uid", "")

            # Search by firebase_uid
            docs = (
                db.collection("user_profiles")
                .where(filter=FieldFilter("firebase_uid", "==", firebase_uid))
                .limit(1)
                .stream()
            )
            for doc in docs:
                d = doc.to_dict()
                d["id"] = doc.id
                return d
        except Exception:
            pass
        return None
