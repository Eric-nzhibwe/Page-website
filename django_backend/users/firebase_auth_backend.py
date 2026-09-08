"""
Firebase Authentication Backend for ARTX
==========================================
Validates Firebase ID tokens issued by the Firebase Auth SDK on the frontend.

Flow
----
  1. Frontend registers/logs in with Firebase Auth (email + password)
  2. Firebase issues an ID token (JWT, valid 1 hour)
  3. Frontend sends:  Authorization: FirebaseToken <id_token>
  4. FirebaseAuthenticationBackend.authenticate() verifies the token
     via firebase_admin.auth.verify_id_token()
  5. If valid → find or create a matching Django User (matched by firebase_uid)
  6. Return the User — DRF treats it as authenticated for the request

The Django User record is a thin local mirror:
  • uid      → stored in UserFirebaseProfile.firebase_uid
  • email    → stored on User.email
  • password → set to an unusable value (User.set_unusable_password())
               Logins always go through Firebase; passwords are never used
  • token    → a standard DRF Token is still issued so the existing API
               clients (api-service.js uses Token auth headers) keep working
               without any frontend changes to other pages

Graceful degradation
--------------------
When Firebase is not configured (no FIREBASE_* env vars), this backend
does nothing and Django falls back to the existing email/password backend
transparently.  The dual-mode design means zero breaking changes.
"""

import logging
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User   = get_user_model()


class FirebaseAuthenticationBackend(BaseBackend):
    """
    DRF-compatible authentication backend.
    Registered in settings.AUTHENTICATION_BACKENDS — Django calls this
    automatically when authenticate() is invoked.
    """

    def authenticate(self, request, firebase_token=None, **kwargs):
        """
        Verify a Firebase ID token and return the matching Django User.
        Returns None when Firebase is not configured or the token is invalid
        so Django moves on to the next backend.
        """
        if not firebase_token:
            return None

        try:
            from artx_platform.firebase_client import firebase_enabled
            if not firebase_enabled():
                return None

            import firebase_admin.auth as fb_auth
            decoded = fb_auth.verify_id_token(firebase_token)
        except Exception as exc:
            logger.warning(f'Firebase token verification failed: {exc}')
            return None

        return self._get_or_create_user(decoded)

    def get_user(self, user_id):
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None

    # ─────────────────────────────────────────────────────────────────────
    #  Internal helpers
    # ─────────────────────────────────────────────────────────────────────

    def _get_or_create_user(self, decoded: dict):
        """
        Find the Django User whose firebase_uid matches the token's uid.
        Creates a new User on first sign-in from Firebase.
        """
        firebase_uid = decoded.get('uid')
        email        = (decoded.get('email') or '').lower().strip()
        name         = decoded.get('name') or ''
        picture      = decoded.get('picture') or ''

        if not firebase_uid:
            logger.error('Firebase token missing uid field')
            return None

        # ── Try to find by firebase_uid first (most reliable) ──────────
        try:
            profile = UserFirebaseProfile.objects.select_related('user').get(
                firebase_uid=firebase_uid
            )
            user = profile.user
            # Keep the local email in sync if Firebase email changed
            if email and user.email != email:
                user.email = email
                user.save(update_fields=['email'])
            return user
        except UserFirebaseProfile.DoesNotExist:
            pass

        # ── Try to find an existing User by email ──────────────────────
        user = None
        if email:
            try:
                user = User.objects.get(email__iexact=email)
            except User.DoesNotExist:
                pass

        # ── Create a new User if none found ────────────────────────────
        if user is None:
            username = self._derive_username(email, name, firebase_uid)
            user = User(
                username    = username,
                email       = email,
                display_name= name,
            )
            user.set_unusable_password()   # logins always go through Firebase
            user.save()
            logger.info(f'Created new User {user.username} from Firebase uid={firebase_uid}')

        # ── Link this User to the Firebase uid ─────────────────────────
        UserFirebaseProfile.objects.get_or_create(
            user=user,
            defaults={'firebase_uid': firebase_uid, 'picture_url': picture},
        )

        return user

    @staticmethod
    def _derive_username(email: str, name: str, uid: str) -> str:
        """
        Derive a unique username from email, display name, or Firebase uid.
        Falls back to uid[:12] if all else conflicts.
        """
        import re

        base = (
            re.sub(r'[^a-zA-Z0-9_]', '', email.split('@')[0])
            or re.sub(r'[^a-zA-Z0-9_]', '', name.replace(' ', '_'))
            or f'user_{uid[:8]}'
        )
        candidate = base[:30]

        # Ensure uniqueness
        if not User.objects.filter(username=candidate).exists():
            return candidate

        suffix = 1
        while True:
            trial = f'{candidate[:27]}_{suffix}'
            if not User.objects.filter(username=trial).exists():
                return trial
            suffix += 1


# ─────────────────────────────────────────────────────────────────────────────
#  UserFirebaseProfile — thin linking table
# ─────────────────────────────────────────────────────────────────────────────
#  Imported here rather than models.py to avoid circular imports.
#  The actual model class is defined in users/models.py (added below by the
#  migration we'll create).  This import works once migrations are run.

try:
    from .models import UserFirebaseProfile
except ImportError:
    # Model not yet created — will be fixed after running migrations
    class UserFirebaseProfile:  # type: ignore
        objects = None
