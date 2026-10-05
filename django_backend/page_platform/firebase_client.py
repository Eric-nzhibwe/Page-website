"""
Firebase Admin SDK initialisation for PAGE Platform.

Initialises the Firebase app once at startup when the required credentials
are present in the environment. When credentials are absent (local dev
without Firebase configured), the module degrades gracefully — all callers
should use firebase_enabled() before touching firebase_admin APIs.
"""
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

_firebase_app = None
_initialised = False


def _clean_private_key(raw: str) -> str:
    """
    Normalise the Firebase private key from whatever format the env var
    arrives in — Render and other hosts frequently mangle PEM keys.

    Handles:
      • Literal \\n  → real newline   (most common Render issue)
      • Surrounding single or double quotes added by some secret managers
      • Extra whitespace around the whole key
      • Keys already containing real newlines (pass-through)
    """
    if not raw:
        return raw

    # Strip surrounding whitespace and quotes
    key = raw.strip().strip('"').strip("'").strip()

    # Replace literal \n sequences with real newlines
    # Do this before checking for header/footer so we don't break a key
    # that already has real newlines mixed with escaped ones.
    if '\\n' in key:
        key = key.replace('\\n', '\n')

    # If the key somehow came in as a single long line without any newlines
    # at all (some CI systems strip newlines), reconstruct it:
    if '\n' not in key and 'BEGIN' in key:
        # Insert newlines after the header and before the footer,
        # and every 64 chars through the base64 body.
        import re
        header_match = re.match(r'(-----BEGIN [^-]+-----)(.+?)(-----END [^-]+-----)', key)
        if header_match:
            header, body, footer = header_match.groups()
            body_lines = [body[i:i+64] for i in range(0, len(body), 64)]
            key = header + '\n' + '\n'.join(body_lines) + '\n' + footer + '\n'

    return key


def firebase_enabled() -> bool:
    """Return True if Firebase Admin has been successfully initialised."""
    _ensure_initialised()
    return _firebase_app is not None


def get_firebase_app():
    """Return the Firebase App instance, or None if not configured."""
    _ensure_initialised()
    return _firebase_app


def get_firestore_client():
    """
    Return a Firestore client authenticated with the Firebase Admin SDK.
    Returns None if Firebase is not configured.
    """
    if not firebase_enabled():
        return None
    try:
        # Use firebase_admin's own Firestore client — authenticated via the
        # service account credential we already initialised. This avoids the
        # "Application Default Credentials" error from google.cloud.firestore.
        from firebase_admin import firestore as fb_firestore
        return fb_firestore.client()
    except Exception as exc:
        logger.warning(f'Could not create Firestore client: {exc}')
        return None


# Alias used by all service modules
get_firestore = get_firestore_client


def _ensure_initialised():
    """Idempotent initialisation — safe to call multiple times."""
    global _firebase_app, _initialised

    if _initialised:
        return

    _initialised = True

    required = [
        settings.FIREBASE_PROJECT_ID,
        settings.FIREBASE_PRIVATE_KEY,
        settings.FIREBASE_CLIENT_EMAIL,
    ]

    # Also accept the single-JSON-blob method
    sa_json = getattr(settings, 'FIREBASE_SERVICE_ACCOUNT_JSON', '').strip()

    if not sa_json and not all(required):
        logger.info(
            'Firebase credentials not configured — '
            'Firebase Auth and Firestore features are disabled.'
        )
        return

    try:
        import firebase_admin
        from firebase_admin import credentials
        import json

        # Avoid re-initialising if another module already did it
        if firebase_admin._apps:
            _firebase_app = firebase_admin.get_app()
            return

        # ── Method 1: full service-account JSON as a single env var ──────────
        # Most reliable on Render — no PEM line-ending issues.
        # Set FIREBASE_SERVICE_ACCOUNT_JSON in Render dashboard to the full
        # contents of your serviceAccountKey.json file (paste the whole JSON).
        sa_json = getattr(settings, 'FIREBASE_SERVICE_ACCOUNT_JSON', '').strip()
        if sa_json:
            try:
                sa_dict = json.loads(sa_json)
                cred = credentials.Certificate(sa_dict)
                _firebase_app = firebase_admin.initialize_app(cred)
                logger.info(f'Firebase Admin initialised via JSON env var for project: {settings.FIREBASE_PROJECT_ID}')
                return
            except Exception as json_exc:
                logger.warning(f'FIREBASE_SERVICE_ACCOUNT_JSON parse failed: {json_exc} — trying individual vars')

        # ── Method 2: individual env vars (with aggressive key cleaning) ──────
        cleaned_key = _clean_private_key(settings.FIREBASE_PRIVATE_KEY)

        # Log key shape for diagnostics (never logs the actual key content)
        lines = cleaned_key.split('\n')
        logger.info(
            f'Firebase key shape: {len(lines)} lines, '
            f'starts={lines[0][:30]!r}, '
            f'ends={lines[-1][-20:]!r}'
        )

        cred = credentials.Certificate({
            'type': 'service_account',
            'project_id': settings.FIREBASE_PROJECT_ID,
            'private_key_id': settings.FIREBASE_PRIVATE_KEY_ID,
            'private_key': cleaned_key,
            'client_email': settings.FIREBASE_CLIENT_EMAIL,
            'client_id': settings.FIREBASE_CLIENT_ID,
            'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
            'token_uri': 'https://oauth2.googleapis.com/token',
            'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs',
            'client_x509_cert_url': settings.FIREBASE_CLIENT_X509_CERT_URL,
        })
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info(f'Firebase Admin initialised for project: {settings.FIREBASE_PROJECT_ID}')

    except Exception as exc:
        logger.error(f'Firebase Admin initialisation failed: {exc}')
        _firebase_app = None
