"""
Firestore Chatbot Service — Phase 3
=====================================
Drop-in replacement for the PostgreSQL-backed ChatConversation /
ChatMessage queries.  Called by chatbot/views.py when
settings.FIRESTORE_COLLECTIONS['chatbot'] is True.

Firestore collection layout
---------------------------
  chat_conversations/
    {user_id}_{conv_id}/           ← document ID keeps user scoping cheap
      id          : str            ← same value as doc id
      user_id     : str            ← UUID
      title       : str
      is_active   : bool
      created_at  : Timestamp
      updated_at  : Timestamp

      messages/                    ← sub-collection
        {message_id}/
          id          : str
          role        : str  — user | assistant | system
          content     : str
          metadata    : dict
          created_at  : Timestamp

Required Firestore composite indexes
(Firebase Console → Firestore → Indexes → Composite):

  chat_conversations
  └── user_id ASC, updated_at DESC

  chat_conversations/{conv_id}/messages
  └── created_at ASC               (auto-index on sub-collection)
"""

import logging
import uuid
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger = logging.getLogger(__name__)

CONV_COLLECTION = 'chat_conversations'


# ─────────────────────────────────────────────────────────────────────────────
#  Conversations — create / list / delete
# ─────────────────────────────────────────────────────────────────────────────

def create_conversation(user, title='New Conversation'):
    """
    Create a new conversation document and return a plain dict that mirrors
    the shape expected by views.py (has an 'id' field).
    """
    db = get_firestore()
    if db is None:
        return None

    conv_id = str(uuid.uuid4())
    doc_id  = _doc_id(user.id, conv_id)
    now     = datetime.now(tz=timezone.utc)

    doc = {
        'id':         conv_id,
        'user_id':    str(user.id),
        'title':      title[:255],
        'is_active':  True,
        'created_at': now,
        'updated_at': now,
    }

    try:
        db.collection(CONV_COLLECTION).document(doc_id).set(doc)
        return doc
    except Exception as exc:
        logger.error(f'Firestore create_conversation error: {exc}')
        return None


def get_conversation(user, conversation_id):
    """
    Fetch a single conversation dict.
    Returns None if not found or does not belong to `user`.
    """
    db = get_firestore()
    if db is None:
        return None

    try:
        snap = db.collection(CONV_COLLECTION).document(
            _doc_id(user.id, conversation_id)
        ).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        if str(d.get('user_id')) != str(user.id):
            return None
        return _fmt_conv(snap)
    except Exception as exc:
        logger.error(f'Firestore get_conversation error: {exc}')
        return None


def list_conversations(user, limit=20):
    """Return the most recent `limit` conversations for `user`."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(CONV_COLLECTION)
            .where('user_id', '==', str(user.id))
            .order_by('updated_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_fmt_conv(d) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore list_conversations error: {exc}')
        return []


def delete_conversation(user, conversation_id):
    """
    Delete a conversation and all its messages.
    Returns True on success, False if not found or not owned by user.
    """
    db = get_firestore()
    if db is None:
        return False

    doc_ref = db.collection(CONV_COLLECTION).document(
        _doc_id(user.id, conversation_id)
    )

    try:
        snap = doc_ref.get()
        if not snap.exists or str(snap.to_dict().get('user_id')) != str(user.id):
            return False

        # Delete all messages in the sub-collection first
        _delete_subcollection(doc_ref.collection('messages'))

        doc_ref.delete()
        return True
    except Exception as exc:
        logger.error(f'Firestore delete_conversation error: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Messages — create / list
# ─────────────────────────────────────────────────────────────────────────────

def save_message(user, conversation_id, role, content, metadata=None):
    """
    Append a message to the conversation's messages sub-collection and bump
    the conversation's updated_at timestamp.
    Returns the message dict with an 'id' field, or None on failure.
    """
    db = get_firestore()
    if db is None:
        return None

    msg_id  = str(uuid.uuid4())
    now     = datetime.now(tz=timezone.utc)
    doc_ref = db.collection(CONV_COLLECTION).document(
        _doc_id(user.id, conversation_id)
    )

    msg_doc = {
        'id':         msg_id,
        'role':       role,
        'content':    content,
        'metadata':   metadata or {},
        'created_at': now,
    }

    try:
        # Write message
        doc_ref.collection('messages').document(msg_id).set(msg_doc)

        # Bump conversation updated_at so the list stays sorted correctly
        doc_ref.update({'updated_at': now})

        return _fmt_msg(msg_doc)
    except Exception as exc:
        logger.error(f'Firestore save_message error: {exc}')
        return None


def get_messages(user, conversation_id, limit=20):
    """
    Return the last `limit` messages for a conversation, oldest first
    (correct order for feeding to the AI as history).
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(CONV_COLLECTION)
            .document(_doc_id(user.id, conversation_id))
            .collection('messages')
            .order_by('created_at')
            .limit_to_last(limit)
            .get()
        )
        return [_fmt_msg(d.to_dict()) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_messages error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(conv_queryset):
    """
    One-time migration: copy ChatConversation + ChatMessage rows from PostgreSQL
    into Firestore.

    Usage:
        from chatbot.models import ChatConversation
        from chatbot.firestore_chat_service import migrate_from_postgres
        migrate_from_postgres(
            ChatConversation.objects.prefetch_related('messages')
                                    .select_related('user')
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_from_postgres (chatbot): Firestore not available.')
        return 0

    BATCH_SIZE  = 200   # keep batches small — each conv can have many messages
    migrated    = 0
    batch       = db.batch()
    count       = 0

    def _commit_if_full():
        nonlocal batch, count
        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0

    for conv in conv_queryset.iterator():
        conv_id  = str(conv.id)
        doc_id   = _doc_id(conv.user_id, conv_id)
        doc_ref  = db.collection(CONV_COLLECTION).document(doc_id)

        conv_doc = {
            'id':         conv_id,
            'user_id':    str(conv.user_id),
            'title':      conv.title,
            'is_active':  conv.is_active,
            'created_at': conv.created_at,
            'updated_at': conv.updated_at,
            '_pg_id':     conv.id,
        }
        batch.set(doc_ref, conv_doc)
        count    += 1
        migrated += 1
        _commit_if_full()

        for msg in conv.messages.order_by('created_at'):
            msg_ref = doc_ref.collection('messages').document(str(msg.id))
            msg_doc = {
                'id':         str(msg.id),
                'role':       msg.role,
                'content':    msg.content,
                'metadata':   msg.metadata or {},
                'created_at': msg.created_at,
                '_pg_id':     msg.id,
            }
            batch.set(msg_ref, msg_doc)
            count    += 1
            migrated += 1
            _commit_if_full()

    if count > 0:
        batch.commit()

    logger.info(f'migrate chatbot: done — {migrated} documents written (convs + msgs).')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _doc_id(user_id, conv_id):
    """Build a deterministic document ID that scopes conversations to a user."""
    return f"{user_id}_{conv_id}"


def _ts(val):
    """Normalise a Firestore Timestamp / datetime to an ISO string."""
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    return str(val)


def _fmt_conv(snap) -> dict:
    """Format a Firestore conversation document to the REST API shape."""
    d = snap.to_dict() if hasattr(snap, 'to_dict') else snap
    return {
        'id':         d.get('id', ''),
        'user_id':    d.get('user_id', ''),
        'title':      d.get('title', 'New Conversation'),
        'is_active':  d.get('is_active', True),
        'created_at': _ts(d.get('created_at')),
        'updated_at': _ts(d.get('updated_at')),
        'messages':   [],   # populated separately when needed
    }


def _fmt_msg(d) -> dict:
    """Format a message dict to the REST API shape."""
    if hasattr(d, 'to_dict'):
        d = d.to_dict()
    return {
        'id':         d.get('id', ''),
        'role':       d.get('role', 'user'),
        'content':    d.get('content', ''),
        'metadata':   d.get('metadata', {}),
        'created_at': _ts(d.get('created_at')),
    }


def _delete_subcollection(col_ref, batch_size=400):
    """Recursively delete all documents in a sub-collection."""
    db = get_firestore()
    if db is None:
        return
    docs = col_ref.limit(batch_size).stream()
    batch = db.batch()
    count = 0
    for doc in docs:
        batch.delete(doc.reference)
        count += 1
    if count:
        batch.commit()
        _delete_subcollection(col_ref, batch_size)  # recurse until empty
