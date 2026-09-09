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
