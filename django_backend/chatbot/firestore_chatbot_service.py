"""
Firestore Chatbot Service — PAGE Platform
==========================================
Mirrors chat sessions and messages to Firestore as a backup / secondary store.
Postgres is always the primary — this runs silently in the background and never
blocks the response or raises to the user.

Firestore collection layout
---------------------------
  chat_sessions/
    {user_id}_{session_id}/          ← deterministic doc ID
      session_id   : int
      user_id      : int
      username     : str             ← denormalised for quick reads
      title        : str
      created_at   : Timestamp
      updated_at   : Timestamp
      messages     : list[dict]      ← full message log embedded in the doc
        - id         : int
        - role       : 'user' | 'assistant'
        - content    : str
        - meta       : dict
        - created_at : Timestamp

Enabled by setting  FS_CHATBOT=True  (or via the Render dashboard).
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

COLLECTION = 'chat_sessions'


def _db():
    """Return Firestore client or None if Firebase is not configured."""
    try:
        from page_platform.firebase_client import get_firestore
        return get_firestore()
    except Exception as exc:
        logger.warning(f'Firestore unavailable: {exc}')
        return None


def _doc_id(user_id, session_id) -> str:
    return f'{user_id}_{session_id}'


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _serialize_message(msg) -> dict:
    """Convert a ChatMessage ORM instance to a plain dict."""
    return {
        'id':         msg.id,
        'role':       msg.role,
        'content':    msg.content,
        'meta':       msg.meta or {},
        'created_at': msg.created_at,
    }


# ── Write helpers ──────────────────────────────────────────────────────────────

def mirror_new_session(session) -> None:
    """
    Called after a new ChatSession is created in Postgres.
    Creates the Firestore document with an empty messages list.
    """
    db = _db()
    if db is None:
        return
    try:
        doc = {
            'session_id': session.id,
            'user_id':    session.user_id,
            'username':   getattr(session.user, 'username', ''),
            'title':      session.title,
            'created_at': session.created_at or _now(),
            'updated_at': session.updated_at or _now(),
            'messages':   [],
        }
        db.collection(COLLECTION).document(_doc_id(session.user_id, session.id)).set(doc)
    except Exception as exc:
        logger.error(f'Firestore mirror_new_session error: {exc}')


def mirror_message_pair(session, user_message, assistant_message) -> None:
    """
    Called after both the user turn and assistant turn are saved to Postgres.
    Appends both messages to the Firestore document and updates updated_at + title.
    Uses Firestore ArrayUnion so concurrent writes don't clobber each other.
    """
    db = _db()
    if db is None:
        return
    try:
        from google.cloud.firestore_v1 import ArrayUnion
        ref = db.collection(COLLECTION).document(_doc_id(session.user_id, session.id))

        ref.set(
            {
                'session_id': session.id,
                'user_id':    session.user_id,
                'username':   getattr(session.user, 'username', ''),
                'title':      session.title,
                'updated_at': assistant_message.created_at or _now(),
                'messages':   ArrayUnion([
                    _serialize_message(user_message),
                    _serialize_message(assistant_message),
                ]),
            },
            merge=True,   # create if missing, update if exists
        )
    except Exception as exc:
        logger.error(f'Firestore mirror_message_pair error: {exc}')


def mirror_session_delete(user_id, session_id) -> None:
    """Called after a ChatSession is deleted from Postgres."""
    db = _db()
    if db is None:
        return
    try:
        db.collection(COLLECTION).document(_doc_id(user_id, session_id)).delete()
    except Exception as exc:
        logger.error(f'Firestore mirror_session_delete error: {exc}')


# ── Read helpers (optional — used if FS_CHATBOT mode ever reads from Firestore) ─

def get_user_sessions(user_id, limit=20) -> list:
    """Return the user's most recent sessions from Firestore (no messages)."""
    db = _db()
    if db is None:
        return []
    try:
        from google.cloud.firestore_v1 import FieldFilter
        docs = (
            db.collection(COLLECTION)
            .where(filter=FieldFilter('user_id', '==', user_id))
            .order_by('updated_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            d = doc.to_dict()
            d.pop('messages', None)   # strip messages for the sidebar list
            results.append(d)
        return results
    except Exception as exc:
        logger.error(f'Firestore get_user_sessions error: {exc}')
        return []


def get_session_with_messages(user_id, session_id) -> dict | None:
    """Return a full session document including messages."""
    db = _db()
    if db is None:
        return None
    try:
        snap = db.collection(COLLECTION).document(_doc_id(user_id, session_id)).get()
        return snap.to_dict() if snap.exists else None
    except Exception as exc:
        logger.error(f'Firestore get_session_with_messages error: {exc}')
        return None
