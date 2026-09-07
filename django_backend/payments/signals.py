"""
Payment signals — mirror wallet, transaction, and payment state to Firestore.

All financial WRITES stay in PostgreSQL.
These signals keep Firestore in sync for fast read-only display.
Connected in payments/apps.py → PaymentsConfig.ready().
"""
import logging
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _should_mirror():
    try:
        from django.conf import settings
        from artx_platform.firebase_client import firebase_enabled
        return (
            settings.FIRESTORE_COLLECTIONS.get('payments', False)
            and firebase_enabled()
        )
    except Exception:
        return False


@receiver(post_save, sender='payments.Wallet')
def mirror_wallet_on_save(sender, instance, **kwargs):
    """Keep the Firestore wallet balance document in sync."""
    if kwargs.get('raw', False):
        return
    if not _should_mirror():
        return
    try:
        from .firestore_payment_service import mirror_wallet
        mirror_wallet(instance)
    except Exception as exc:
        logger.error(f'mirror_wallet_on_save failed for user {instance.user_id}: {exc}')


@receiver(post_save, sender='payments.Transaction')
def mirror_transaction_on_save(sender, instance, created, **kwargs):
    """Append each new transaction to the Firestore txs sub-collection."""
    if kwargs.get('raw', False) or not created:
        return  # Only mirror new transactions, never updates
    if not _should_mirror():
        return
    try:
        from .firestore_payment_service import mirror_transaction
        mirror_transaction(instance)
    except Exception as exc:
        logger.error(f'mirror_transaction_on_save failed for tx {instance.id}: {exc}')


@receiver(post_save, sender='payments.Payment')
def mirror_payment_status_on_save(sender, instance, **kwargs):
    """Update the Firestore payment status document for frontend polling."""
    if kwargs.get('raw', False):
        return
    if not _should_mirror():
        return
    try:
        from .firestore_payment_service import mirror_payment_status
        mirror_payment_status(instance)
    except Exception as exc:
        logger.error(f'mirror_payment_status_on_save failed for {instance.id}: {exc}')
