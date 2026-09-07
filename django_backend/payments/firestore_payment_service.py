"""
Firestore Payment Mirror Service — Phase 9
============================================
⚠️  ARCHITECTURE DECISION — READ THIS BEFORE CHANGING ANYTHING:

    All financial WRITES (deposits, withdrawals, balance deductions, entries
    for entry fees, prize credits) remain in PostgreSQL EXCLUSIVELY.
    The wallet uses SELECT FOR UPDATE + F() atomic expressions + db.atomic()
    — none of that is available in Firestore, and replicating it would risk
    double-spends, race conditions, and lost funds.

    This service ONLY mirrors data to Firestore for FAST READS:
      • Wallet balance summary  →  user_profiles (already synced in Phase 8)
      • Transaction history     →  wallet_transactions/{user_id}/txs/
      • Payment status          →  payment_status/{payment_id}/

    The frontend can read these Firestore documents instead of hitting the
    Django API for every page load — but Django always has the source of truth.

    Firestore collection layout (read-only mirrors):
    ─────────────────────────────────────────────────
    wallet_transactions/
      {user_id}/
        balance          : float   ← latest available_balance (denormalised)
        currency         : str
        updated_at       : Timestamp

        txs/             ← sub-collection, append-only
          {tx_id}/
            id                : str
            transaction_type  : str
            amount            : float   ← negative = debit, positive = credit
            balance_after     : float
            description       : str
            metadata          : dict
            created_at        : Timestamp

    payment_status/
      {payment_id}/
        id               : str
        user_id          : str
        provider         : str
        amount           : float
        currency         : str
        status           : str
        description      : str
        created_at       : Timestamp
        updated_at       : Timestamp

    Required Firestore indexes:
      wallet_transactions/{uid}/txs → created_at DESC  (auto single-field)
      payment_status → user_id ASC, created_at DESC    (composite)
"""

import logging
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger        = logging.getLogger(__name__)
WALLET_COLL   = 'wallet_transactions'
PAYMENT_COLL  = 'payment_status'


# ─────────────────────────────────────────────────────────────────────────────
#  Mirror wallet state
# ─────────────────────────────────────────────────────────────────────────────

def mirror_wallet(wallet) -> bool:
    """
    Overwrite the wallet summary document for a user.
    Called from a post_save signal on Wallet (see signals.py).
    Never raises — returns False on failure.
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        db.collection(WALLET_COLL).document(str(wallet.user_id)).set({
            'user_id':           str(wallet.user_id),
            'balance':           float(wallet.available_balance),
            'pending_balance':   float(wallet.pending_balance),
            'total_deposited':   float(wallet.total_deposited),
            'total_withdrawn':   float(wallet.total_withdrawn),
            'total_earned':      float(wallet.total_earned),
            'currency':          wallet.currency,
            'is_locked':         wallet.is_locked,
            'updated_at':        datetime.now(tz=timezone.utc),
        })
        return True
    except Exception as exc:
        logger.error(f'Firestore mirror_wallet error for user {wallet.user_id}: {exc}')
        return False


def mirror_transaction(transaction) -> bool:
    """
    Append a single Transaction to the user's txs sub-collection.
    Called from a post_save signal on Transaction (see signals.py).
    Never raises — returns False on failure.
    """
    db = get_firestore()
    if db is None:
        return False

    user_id = str(transaction.wallet.user_id)
    tx_id   = str(transaction.id)

    try:
        doc = {
            'id':               tx_id,
            'transaction_type': transaction.transaction_type,
            'amount':           float(transaction.amount),
            'balance_after':    float(transaction.balance_after),
            'description':      transaction.description,
            'metadata':         transaction.metadata or {},
            'created_at':       transaction.created_at,
        }
        (db.collection(WALLET_COLL)
           .document(user_id)
           .collection('txs')
           .document(tx_id)
           .set(doc))

        # Also keep the wallet summary balance in sync
        (db.collection(WALLET_COLL)
           .document(user_id)
           .update({
               'balance':    float(transaction.balance_after),
               'updated_at': datetime.now(tz=timezone.utc),
           }))
        return True
    except Exception as exc:
        logger.error(f'Firestore mirror_transaction error for tx {tx_id}: {exc}')
        return False


def mirror_payment_status(payment) -> bool:
    """
    Mirror a Payment's status for cheap frontend polling.
    Called from a post_save signal on Payment (see signals.py).
    """
    db = get_firestore()
    if db is None:
        return False

    try:
        db.collection(PAYMENT_COLL).document(str(payment.id)).set({
            'id':          str(payment.id),
            'user_id':     str(payment.user_id),
            'provider':    payment.provider,
            'amount':      float(payment.amount),
            'currency':    payment.currency,
            'status':      payment.status,
            'description': payment.description,
            'created_at':  payment.created_at,
            'updated_at':  payment.updated_at or datetime.now(tz=timezone.utc),
        })
        return True
    except Exception as exc:
        logger.error(f'Firestore mirror_payment_status error for {payment.id}: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Read (used when FS_PAYMENTS flag is on for read endpoints)
# ─────────────────────────────────────────────────────────────────────────────

def get_wallet_balance(user_id: str) -> dict | None:
    """Return the latest wallet summary from Firestore."""
    db = get_firestore()
    if db is None:
        return None
    try:
        snap = db.collection(WALLET_COLL).document(str(user_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        return {
            'balance':         d.get('balance', 0.0),
            'pending_balance': d.get('pending_balance', 0.0),
            'total_deposited': d.get('total_deposited', 0.0),
            'total_withdrawn': d.get('total_withdrawn', 0.0),
            'total_earned':    d.get('total_earned', 0.0),
            'currency':        d.get('currency', 'ZMW'),
            'is_locked':       d.get('is_locked', False),
            'updated_at':      _ts(d.get('updated_at')),
        }
    except Exception as exc:
        logger.error(f'Firestore get_wallet_balance error: {exc}')
        return None


def get_transaction_history(user_id: str, tx_type: str = None,
                             limit: int = 50) -> list:
    """Return transaction history from Firestore."""
    db = get_firestore()
    if db is None:
        return []
    try:
        q = (db.collection(WALLET_COLL)
               .document(str(user_id))
               .collection('txs')
               .order_by('created_at', direction='DESCENDING')
               .limit(limit))
        if tx_type:
            q = q.where('transaction_type', '==', tx_type)
        docs = q.stream()
        return [_fmt_tx(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_transaction_history error: {exc}')
        return []


def get_payment_status(payment_id: str, user_id: str) -> dict | None:
    """Return mirrored payment status (for polling)."""
    db = get_firestore()
    if db is None:
        return None
    try:
        snap = db.collection(PAYMENT_COLL).document(str(payment_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        if str(d.get('user_id')) != str(user_id):
            return None  # security: user can only see their own payments
        return {
            'id':          d.get('id'),
            'provider':    d.get('provider'),
            'amount':      d.get('amount'),
            'currency':    d.get('currency'),
            'status':      d.get('status'),
            'description': d.get('description'),
            'created_at':  _ts(d.get('created_at')),
            'updated_at':  _ts(d.get('updated_at')),
        }
    except Exception as exc:
        logger.error(f'Firestore get_payment_status error: {exc}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helpers (one-time backfill from PostgreSQL)
# ─────────────────────────────────────────────────────────────────────────────

def migrate_wallets(wallet_queryset) -> int:
    """
    Mirror existing Wallet rows into Firestore.

    Usage:
        from payments.models import Wallet
        from payments.firestore_payment_service import migrate_wallets
        migrate_wallets(Wallet.objects.select_related('user').all())
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_wallets: Firestore not available.')
        return 0

    BATCH_SIZE = 400
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for wallet in wallet_queryset.iterator():
        ref = db.collection(WALLET_COLL).document(str(wallet.user_id))
        batch.set(ref, {
            'user_id':         str(wallet.user_id),
            'balance':         float(wallet.available_balance),
            'pending_balance': float(wallet.pending_balance),
            'total_deposited': float(wallet.total_deposited),
            'total_withdrawn': float(wallet.total_withdrawn),
            'total_earned':    float(wallet.total_earned),
            'currency':        wallet.currency,
            'is_locked':       wallet.is_locked,
            'updated_at':      wallet.updated_at,
        })
        count    += 1
        migrated += 1
        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0

    if count:
        batch.commit()
    logger.info(f'migrate_wallets: {migrated} wallet(s) mirrored.')
    return migrated


def migrate_transactions(tx_queryset) -> int:
    """
    Mirror recent Transaction rows into Firestore txs sub-collections.

    Usage:
        from payments.models import Transaction
        from payments.firestore_payment_service import migrate_transactions
        migrate_transactions(
            Transaction.objects.select_related('wallet__user')
                                .order_by('created_at')
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_transactions: Firestore not available.')
        return 0

    BATCH_SIZE = 300
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for tx in tx_queryset.iterator():
        user_id = str(tx.wallet.user_id)
        tx_id   = str(tx.id)
        ref     = (db.collection(WALLET_COLL)
                     .document(user_id)
                     .collection('txs')
                     .document(tx_id))
        batch.set(ref, {
            'id':               tx_id,
            'transaction_type': tx.transaction_type,
            'amount':           float(tx.amount),
            'balance_after':    float(tx.balance_after),
            'description':      tx.description,
            'metadata':         tx.metadata or {},
            'created_at':       tx.created_at,
            '_pg_id':           tx_id,
        })
        count    += 1
        migrated += 1
        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0

    if count:
        batch.commit()
    logger.info(f'migrate_transactions: {migrated} transaction(s) mirrored.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    if hasattr(val, 'timestamp'):
        return datetime.fromtimestamp(val.timestamp(), tz=timezone.utc).isoformat()
    return str(val)


def _fmt_tx(d: dict) -> dict:
    return {
        'id':               d.get('id', ''),
        'transaction_type': d.get('transaction_type', ''),
        'amount':           d.get('amount', 0.0),
        'balance_after':    d.get('balance_after', 0.0),
        'description':      d.get('description', ''),
        'metadata':         d.get('metadata', {}),
        'created_at':       _ts(d.get('created_at')),
    }
