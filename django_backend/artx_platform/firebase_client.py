"""
Firebase / Firestore client for ARTX Platform
===============================================
Single initialisation point for the Firebase Admin SDK.
All apps import `get_firestore()` from here — never initialise
the SDK themselves.

Usage
-----
    from artx_platform.firebase_client import get_firestore, firebase_enabled

    if firebase_enabled():
        db = get_firestore()
        db.collection('notifications').add({...})

Environment variables required (set in Render dashboard / .env):
    FIREBASE_PROJECT_ID      e.g. artx-platform-abc12
    FIREBASE_PRIVATE_KEY_ID  from the service-account JSON
    FIREBASE_PRIVATE_KEY     the full PEM block  (\\n escaped in .env)
    FIREBASE_CLIENT_EMAIL    firebase-adminsdk-xxx@<project>.iam.gserviceaccount.com
    FIREBASE_CLIENT_ID       numeric client id from the service-account JSON
    FIREBASE_CLIENT_X509_CERT_URL  (optional, but keeps the cert chain valid)

How to get these values
-----------------------
1. Firebase Console → Project Settings → Service Accounts
2. Click "Generate new private key"  → downloads a JSON file
3. Copy each field from the JSON into the env vars above.
   FIREBASE_PRIVATE_KEY must keep the \\n sequences — paste the
   raw value including the "-----BEGIN/END PRIVATE KEY-----" header/footer.
"""

import logging
import os

from django.conf import settings

logger = logging.getLogger(__name__)

_app     = None   # firebase_admin.App singleton
_db      = None   # google.cloud.firestore.Client singleton
_enabled = None   # tri-state: None = not yet checked


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

def firebase_enabled() -> bool:
    """
    Returns True when all required Firebase env vars are present and the
    Admin SDK has been (or can be) initialised successfully.
    Safe to call at import time or in any view — always returns a bool.
    """
    global _enabled
    if _enabled is None:
        _enabled = _try_init()
    return _enabled


def get_firestore():
    """
    Return the initialised Firestore client.
    Returns None (and logs a warning) when Firebase is not configured.
    Always call firebase_enabled() first if you need to branch on it.
    """
    if not firebase_enabled():
        return None
    return _db


def get_firebase_app():
    """Return the firebase_admin.App instance, or None."""
    if not firebase_enabled():
        return None
    return _app


# ─────────────────────────────────────────────────────────────────────────────
#  Internal initialisation
# ─────────────────────────────────────────────────────────────────────────────

def _try_init() -> bool:
    """
    Attempt to initialise the Firebase Admin SDK.
    Returns True on success, False on any failure.
    Safe to call multiple times — subsequent calls are no-ops.
    """
    global _app, _db

    if _app is not None:
        return True  # already initialised

    # ── Collect credentials ────────────────────────────────────────────────
    project_id    = _cfg('FIREBASE_PROJECT_ID')
    private_key   = _cfg('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n')
    client_email  = _cfg('FIREBASE_CLIENT_EMAIL')

    if not all([project_id, private_key, client_email]):
        # Not configured — this is fine in local dev without Firebase
        logger.debug(
            'Firebase not configured (FIREBASE_PROJECT_ID / FIREBASE_PRIVATE_KEY / '
            'FIREBASE_CLIENT_EMAIL missing). Firestore will be disabled.'
        )
        return False

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore

        # Build the service-account credential dict from individual env vars
        # so the developer never has to upload a JSON file to the server.
        service_account = {
            'type':                        'service_account',
            'project_id':                  project_id,
            'private_key_id':              _cfg('FIREBASE_PRIVATE_KEY_ID', ''),
            'private_key':                 private_key,
            'client_email':                client_email,
            'client_id':                   _cfg('FIREBASE_CLIENT_ID', ''),
            'auth_uri':                    'https://accounts.google.com/o/oauth2/auth',
            'token_uri':                   'https://oauth2.googleapis.com/token',
            'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs',
            'client_x509_cert_url':        _cfg(
                'FIREBASE_CLIENT_X509_CERT_URL',
                f'https://www.googleapis.com/robot/v1/metadata/x509/{client_email}',
            ),
        }

        cred = credentials.Certificate(service_account)

        # Avoid "app already exists" error on hot-reload (e.g. Django dev server)
        try:
            _app = firebase_admin.get_app()
        except ValueError:
            _app = firebase_admin.initialize_app(cred)

        _db = firestore.client()
        logger.info(f'Firebase initialised — project: {project_id}')
        return True

    except ImportError:
        logger.warning(
            'firebase-admin is not installed. '
            'Run: pip install firebase-admin==6.5.0'
        )
        return False

    except Exception as exc:
        logger.error(f'Firebase initialisation failed: {exc}')
        return False


def _cfg(key: str, default: str = '') -> str:
    """Read from Django settings first, fall back to os.environ."""
    val = getattr(settings, key, None)
    if val:
        return str(val)
    return os.environ.get(key, default)
