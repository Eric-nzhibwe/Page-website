"""
page_platform/ws_auth.py
─────────────────────────
Shared WebSocket authentication helper used by every Django Channels consumer.

Supports two token formats passed as the `?token=` query-string parameter:

  1. DRF Token  (40-char hex string)
     ?token=<drf_token>
     → looks up rest_framework.authtoken.models.Token in the database

  2. Firebase ID Token  (JWT, prefixed "fb:" to disambiguate)
     ?token=fb:<firebase_id_token>
     → verifies via Firebase Admin SDK; falls back to EphemeralUser if DB
       is unavailable, so WebSocket connections stay alive even when
       Postgres is down (Render free-tier suspension etc.)

Both paths return a (user, error_str) tuple so existing consumer code
needs zero changes except swapping the import.
"""

import logging
from urllib.parse import unquote

from channels.db import database_sync_to_async

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  Query-string helpers
# ─────────────────────────────────────────────────────────────────────────────

def _token_from_scope(scope):
    """
    Extract the raw token value from the WebSocket URL query string.

    Consumers pass tokens in two ways:
      - DRF token  → ?token=<40-char hex>
      - Firebase   → ?token=fb:<firebase_id_token>   (frontend prefixes "fb:")
    """
    qs = scope.get("query_string", b"").decode()
    for part in qs.split("&"):
        if part.startswith("token="):
            return unquote(part.split("=", 1)[1])
    return None


# ─────────────────────────────────────────────────────────────────────────────
#  DRF Token lookup (sync DB call wrapped for async consumers)
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_drf_token(token_key):
    """Synchronous — call via database_sync_to_async."""
    if not token_key:
        return None, "no_token"
    try:
        from rest_framework.authtoken.models import Token
        tok = Token.objects.select_related("user").get(key=token_key)
        if not tok.user.is_active:
            return None, "inactive"
        return tok.user, None
    except Token.DoesNotExist:
        return None, "invalid_token"
    except Exception as exc:
        logger.warning("DRF token lookup failed: %s", exc)
        return None, str(exc)


# ─────────────────────────────────────────────────────────────────────────────
#  Firebase ID Token verification
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_firebase_token(id_token):
    """
    Verify a Firebase ID token and return a Django User.

    Steps:
      1. Verify the JWT via Firebase Admin SDK → get decoded claims
      2. Look up / create a Django User in Postgres (best-effort)
      3. If Postgres is down, return an EphemeralUser so the connection lives

    Returns (user, error_str).
    """
    if not id_token:
        return None, "no_token"

    # ── 1. Firebase must be configured ──────────────────────────────────────
    try:
        from page_platform.firebase_client import firebase_enabled
        if not firebase_enabled():
            return None, "firebase_not_configured"
    except Exception:
        return None, "firebase_not_configured"

    # ── 2. Verify the JWT ────────────────────────────────────────────────────
    try:
        import firebase_admin.auth as fb_auth
        decoded = fb_auth.verify_id_token(id_token)
    except Exception as exc:
        logger.warning("Firebase WS token verification failed: %s", exc)
        return None, f"firebase_invalid: {exc}"

    # ── 3. Try to find / create the Django User in Postgres ─────────────────
    try:
        from users.firebase_auth_backend import FirebaseAuthenticationBackend
        user = FirebaseAuthenticationBackend()._get_or_create_user(decoded)
        if user is not None:
            return user, None
    except Exception as exc:
        logger.warning(
            "Firebase WS: DB unavailable for uid=%s — using ephemeral user. %s",
            decoded.get("uid", "?"), exc,
        )

    # ── 4. DB unavailable — return an EphemeralUser so the WS stays open ────
    # The consumer can broadcast events; write operations will degrade gracefully.
    try:
        from users.firebase_token_auth import EphemeralUser, FirebaseTokenAuthentication
        firestore_profile = FirebaseTokenAuthentication._get_firestore_profile(decoded)
        return EphemeralUser(decoded, firestore_profile), None
    except Exception as exc:
        logger.error("Firebase WS: could not build EphemeralUser: %s", exc)
        return None, "ephemeral_user_failed"


# ─────────────────────────────────────────────────────────────────────────────
#  Public async interface — drop-in replacement for each consumer's helper
# ─────────────────────────────────────────────────────────────────────────────

@database_sync_to_async
def get_user_from_token(token_key):
    """
    Async-safe entry point called from every WebSocket consumer's connect().

    Accepts:
      - A plain 40-char DRF token string
      - A "fb:<firebase_id_token>" prefixed string (set by the frontend)

    Returns (user, error_str).  error_str is None on success.
    """
    if not token_key:
        return None, "no_token"

    # Firebase tokens are prefixed "fb:" by the frontend to avoid ambiguity
    if token_key.startswith("fb:"):
        return _resolve_firebase_token(token_key[3:])

    # Looks like a DRF token — try it first
    user, err = _resolve_drf_token(token_key)
    if user is not None:
        return user, None

    # Could be an unprefixed Firebase JWT (older client builds).
    # Firebase JWTs are long (>100 chars) and contain dots — DRF tokens never do.
    if len(token_key) > 100 and "." in token_key:
        logger.debug("WS auth: treating long dotted token as Firebase JWT")
        return _resolve_firebase_token(token_key)

    return None, err
