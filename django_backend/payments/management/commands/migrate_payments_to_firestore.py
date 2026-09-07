"""
Management command: migrate_payments_to_firestore
==================================================
Mirrors existing Wallet balances and Transaction history from PostgreSQL
into Firestore (read-only display copies).

⚠️  SAFETY RULES — READ BEFORE RUNNING:
    • This command NEVER moves financial write logic to Firestore.
    • All deposits, withdrawals, and deductions remain in PostgreSQL.
    • Firestore documents created here are READ-ONLY mirrors for the UI.
    • If Firestore and PostgreSQL ever disagree, PostgreSQL is ALWAYS right.
    • Run --dry-run first to confirm counts before writing anything.

Usage:
    python manage.py migrate_payments_to_firestore --dry-run
    python manage.py migrate_payments_to_firestore
    python manage.py migrate_payments_to_firestore --wallets-only
    python manage.py migrate_payments_to_firestore --transactions-only
    python manage.py migrate_payments_to_firestore --user-id <uuid>
    python manage.py migrate_payments_to_firestore --last-days 30
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = (
        'Mirror wallet balances and transaction history from PostgreSQL to '
        'Firestore for fast read-only display. Financial writes stay in PostgreSQL.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview counts without writing.')
        parser.add_argument('--wallets-only', action='store_true',
                            help='Only mirror wallet summaries.')
        parser.add_argument('--transactions-only', action='store_true',
                            help='Only mirror transaction history.')
        parser.add_argument('--user-id', type=str, default=None,
                            help='Only migrate data for this user UUID.')
        parser.add_argument('--last-days', type=int, default=None,
                            help='Only migrate transactions from the last N days.')

    def handle(self, *args, **options):
        dry_run       = options['dry_run']
        wallets_only  = options['wallets_only']
        txs_only      = options['transactions_only']
        user_id       = options['user_id']
        last_days     = options['last_days']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from payments.models import Wallet, Transaction
        from payments.firestore_payment_service import (
            migrate_wallets, migrate_transactions
        )

        # ── Build querysets ────────────────────────────────────────────────
        wallet_qs = Wallet.objects.select_related('user').all()
        tx_qs     = (Transaction.objects
                     .select_related('wallet__user')
                     .order_by('created_at'))

        if user_id:
            wallet_qs = wallet_qs.filter(user_id=user_id)
            tx_qs     = tx_qs.filter(wallet__user_id=user_id)

        if last_days:
            from django.utils import timezone as tz
            from datetime import timedelta
            cutoff = tz.now() - timedelta(days=last_days)
            tx_qs  = tx_qs.filter(created_at__gte=cutoff)

        wallet_count = wallet_qs.count() if not txs_only else 0
        tx_count     = tx_qs.count()     if not wallets_only else 0

        self.stdout.write(
            f'Found {wallet_count} wallet(s) and {tx_count} transaction(s) to mirror.'
        )
        self.stdout.write(self.style.WARNING(
            'REMINDER: Financial writes remain in PostgreSQL. '
            'Firestore mirrors are for display only.'
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry run — no data written.'))
            return

        if wallet_count + tx_count == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        total_written = 0

        if not txs_only and wallet_count:
            self.stdout.write('Mirroring wallets…')
            total_written += migrate_wallets(wallet_qs)

        if not wallets_only and tx_count:
            self.stdout.write('Mirroring transactions…')
            total_written += migrate_transactions(tx_qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {total_written} document(s) written to Firestore.\n\n'
            'Before flipping the flag, create this Firestore index\n'
            '(Firebase Console → Firestore → Indexes → Composite):\n\n'
            '  Collection: payment_status\n'
            '  Index: user_id ASC, created_at DESC\n\n'
            '  The wallet_transactions txs sub-collection auto-indexes on created_at.\n\n'
            'Then:\n'
            '  1. Verify in Firebase Console → Firestore → wallet_transactions\n'
            '  2. Set FS_PAYMENTS=True in Render env vars\n'
            '  3. Redeploy — wallet_balance_view, transaction_history_view,\n'
            '     and payment_status_view will now read from Firestore.\n'
            '  4. ALL financial writes (deposits/withdrawals/deductions) remain\n'
            '     in PostgreSQL permanently — Firestore is display-only.\n\n'
            '⚠️  If balances ever diverge, run this command again to resync.'
        ))
