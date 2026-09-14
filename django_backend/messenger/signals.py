"""
Messenger signals — mirror messages to Firestore after every save.
Connected in messenger/apps.py → MessengerConfig.ready().
Only fires when Firebase is configured (firebase_enabled() → True).
"""
import logging
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender='messenger.Message')
def mirror_message_to_firestore(sender, instance, created, **kwargs):
    """Push every new message to Firestore for real-time delivery."""
    if not created:
        return  # only mirror new messages, not edits

    if kwargs.get('raw', False):
        return  # skip loaddata / fixtures

    try:
        from artx_platform.firebase_client import firebase_enabled
        if not firebase_enabled():
            return

        # FIX Bug 1 + Bug 6: Do NOT do a blocking Firestore READ here.
        # The old approach read the doc to check if it already existed (to skip
        # re-mirroring voice notes uploaded via Firebase Storage).  That caused:
        #   • A synchronous Firestore round-trip on every single message save
        #   • A race: the tempId written by the client ≠ str(message.id), so
        #     the check never matched and a second doc with media_url=None was
        #     always written, overwriting the correct Firebase Storage URL.
        #
        # New approach: check the model field instead — no network call needed.
        # If firebase_media_url is set, mirror_message_with_url() already ran
        # (called directly from the view), so we skip here to avoid overwrite.
        if instance.firebase_media_url:
            return  # already mirrored by the view with the correct Storage URL

        from .firestore_messenger_service import mirror_message
        mirror_message(instance)
    except Exception as exc:
        # Never crash the request if Firestore is unavailable
        logger.error(f'mirror_message_to_firestore failed for msg {instance.id}: {exc}')


@receiver(post_save, sender='messenger.Conversation')
def mirror_conversation_to_firestore(sender, instance, created, **kwargs):
    """Push new conversations to Firestore so listeners can subscribe."""
    if not created:
        return

    if kwargs.get('raw', False):
        return

    try:
        from artx_platform.firebase_client import firebase_enabled
        if not firebase_enabled():
            return
        from .firestore_messenger_service import mirror_conversation
        # Participants may not be set yet on a brand-new Conversation —
        # use transaction.on_commit so M2M is flushed first
        from django.db import transaction
        transaction.on_commit(lambda: mirror_conversation(instance))
    except Exception as exc:
        logger.error(f'mirror_conversation_to_firestore failed for conv {instance.id}: {exc}')
