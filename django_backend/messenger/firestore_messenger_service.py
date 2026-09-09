"""
Firestore Messenger Service
============================
Mirrors every message and conversation state to Firestore so the
frontend can use real-time listeners instead of polling.

PostgreSQL remains the authoritative source for all writes.
Firestore is a real-time read mirror only.

Firestore collection layout
---------------------------
  messenger_conversations/
    {conversation_id}/             ← str(Conversation.pk)
      id               : str
      participant_ids  : list[str]  ← UUIDs of both users
      participant_data : dict       ← {uid: {username, display_name, avatar}}
      last_message     : dict | null
      unread_counts    : dict       ← {uid: int}
      updated_at       : Timestamp

      messages/                    ← sub-collection
        {message_id}/              ← str(Message.pk)
          id           : str
          conversation_id : str
          sender_id    : str
          sender_username : str
          sender_avatar : str | null
          message_type : str
          text         : str | null
          media_url    : str | null
          timestamp    : Timestamp
          read         : bool

Required Firestore indexes (create in Firebase Console → Indexes):
  messenger_conversations
  └── participant_ids ARRAY_CONTAINS + updated_at DESC

  messenger_conversations/{id}/messages
  └── timestamp ASC  (auto single-field — created on first query)
"""

import logging
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger         = logging.getLogger(__name__)
CONV_COLL      = 'messenger_conversations'


# ─────────────────────────────────────────────────────────────────────────────
#  Public API — called by signals
# ─────────────────────────────────────────────────────────────────────────────

def mirror_message(message) -> bool:
    """
    Write a new message document to Firestore and update the parent
    conversation document's last_message + unread_counts.
    Called from Message post_save signal (created=True only).
    Returns True on success.
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        conv        = message.conversation
        conv_id     = str(conv.id)
        msg_id      = str(message.id)
        sender      = message.sender
        now         = datetime.now(tz=timezone.utc)

        # ── Resolve media URL (may be None on Render ephemeral disk) ─────────
        media_url = None
        try:
            if message.media_file:
                media_url = message.media_file.url
        except Exception:
            pass

        # ── Build message document ────────────────────────────────────────────
        msg_doc = {
            'id':               msg_id,
            'conversation_id':  conv_id,
            'sender_id':        str(sender.id),
            'sender_username':  sender.username,
            'sender_avatar':    _avatar_url(sender),
            'message_type':     message.message_type,
            'text':             message.text,
            'media_url':        media_url,
            'timestamp':        message.timestamp or now,
            'read':             message.read,
        }

        conv_ref = db.collection(CONV_COLL).document(conv_id)

        # Write the message to the sub-collection
        conv_ref.collection('messages').document(msg_id).set(msg_doc)

        # ── Update / create the conversation summary document ─────────────────
        participants = list(conv.participants.select_related())
        p_ids        = [str(p.id) for p in participants]
        p_data       = {
            str(p.id): {
                'username':     p.username,
                'display_name': p.display_name or p.username,
                'avatar':       _avatar_url(p),
                'access_tier':  p.access_tier,
            }
            for p in participants
        }

        last_msg_summary = {
            'id':           msg_id,
            'message_type': message.message_type,
            'text':         message.text,
            'sender_id':    str(sender.id),
            'timestamp':    message.timestamp or now,
            'read':         message.read,
        }

        # Increment unread count for every participant who isn't the sender
        snap = conv_ref.get()
        existing_unread = {}
        if snap.exists:
            existing_unread = snap.to_dict().get('unread_counts', {})

        new_unread = dict(existing_unread)
        for p in participants:
            uid = str(p.id)
            if uid != str(sender.id):
                new_unread[uid] = new_unread.get(uid, 0) + 1

        conv_ref.set({
            'id':               conv_id,
            'participant_ids':  p_ids,
            'participant_data': p_data,
            'last_message':     last_msg_summary,
            'unread_counts':    new_unread,
            'updated_at':       now,
        }, merge=True)

        return True

    except Exception as exc:
        logger.error(f'Firestore mirror_message error for msg {message.id}: {exc}')
        return False


def mark_read_in_firestore(conversation_id: str, reader_user_id: str) -> bool:
    """
    Reset the unread counter to 0 for reader_user_id in a conversation.
    Called after messages are marked read in PostgreSQL.
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        conv_ref = db.collection(CONV_COLL).document(str(conversation_id))
        conv_ref.update({
            f'unread_counts.{reader_user_id}': 0,
        })
        return True
    except Exception as exc:
        logger.error(f'Firestore mark_read_in_firestore error: {exc}')
        return False


def mirror_conversation(conversation) -> bool:
    """
    Create or refresh the conversation summary document (no messages).
    Called when a new conversation is created.
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        from datetime import datetime, timezone
        conv_id      = str(conversation.id)
        participants = list(conversation.participants.select_related())
        p_ids        = [str(p.id) for p in participants]
        p_data       = {
            str(p.id): {
                'username':     p.username,
                'display_name': p.display_name or p.username,
                'avatar':       _avatar_url(p),
                'access_tier':  p.access_tier,
            }
            for p in participants
        }

        db.collection(CONV_COLL).document(conv_id).set({
            'id':               conv_id,
            'participant_ids':  p_ids,
            'participant_data': p_data,
            'last_message':     None,
            'unread_counts':    {str(p.id): 0 for p in participants},
            'updated_at':       datetime.now(tz=timezone.utc),
        }, merge=True)
        return True
    except Exception as exc:
        logger.error(f'Firestore mirror_conversation error: {exc}')
        return False


def get_firebase_config() -> dict:
    """
    Return the public Firebase web SDK config dict so the frontend
    can initialise the Firebase JS SDK from the backend API response.
    All values come from settings (set via env vars) — nothing secret.
    """
    from django.conf import settings as _s
    return {
        'apiKey':            getattr(_s, 'FIREBASE_WEB_API_KEY',         ''),
        'authDomain':        getattr(_s, 'FIREBASE_AUTH_DOMAIN',         ''),
        'projectId':         getattr(_s, 'FIREBASE_PROJECT_ID',          ''),
        'storageBucket':     getattr(_s, 'FIREBASE_STORAGE_BUCKET',      ''),
        'messagingSenderId': getattr(_s, 'FIREBASE_MESSAGING_SENDER_ID', ''),
        'appId':             getattr(_s, 'FIREBASE_APP_ID',              ''),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _avatar_url(user) -> str | None:
    """Return absolute profile image URL or None."""
    if not user.profile_image:
        return None
    try:
        if user.profile_image.storage.exists(user.profile_image.name):
            return user.profile_image.url
    except Exception:
        pass
    return None
