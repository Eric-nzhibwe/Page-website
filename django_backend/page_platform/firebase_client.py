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


def firebase_enabled() -> bool:
    """Return True if Firebase Admin has been successfully initialised."""
    _ensure_initialised()
    return _firebase_app is not None


def get_firebase_app():
    """Return the Firebase App instance, or None if not configured."""
    _ensure_initialised()
    return _firebase_app


def get_firestore_client():
    """Return a Firestore client, or None if Firebase is not configured."""
    if not firebase_enabled():
        return None
    try:
        from google.cloud import firestore
        return firestore.Client(project=settings.FIREBASE_PROJECT_ID)
    except Exception as exc:
        logger.warning(f'Could not create Firestore client: {exc}')
        return None


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

    if not all(required):
        logger.info(
            'Firebase credentials not configured — '
            'Firebase Auth and Firestore features are disabled.'
        )
        return

    try:
        import firebase_admin
        from firebase_admin import credentials

        # Avoid re-initialising if another module already did it
        if firebase_admin._apps:
            _firebase_app = firebase_admin.get_app()
            return

        cred = credentials.Certificate({
            'type': 'service_account',
            'project_id': settings.FIREBASE_PROJECT_ID,
            'private_key_id': settings.FIREBASE_PRIVATE_KEY_ID,
            'private_key': settings.FIREBASE_PRIVATE_KEY,
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
