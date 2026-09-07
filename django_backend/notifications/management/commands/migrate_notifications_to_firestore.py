"""
Management command: migrate_notifications_to_firestore
=======================================================
Copies all existing InAppNotification rows from PostgreSQL into Firestore.
Run this ONCE before flipping FS_NOTIFICATIONS=True in your env.

Usage:
    python manage.py migrate_notifications_to_firestore
    python manage.py migrate_notifications_to_firestore --dry-run
    python manage.py migrate_notifications_to_firestore --user-id <uuid>
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate InAppNotification rows from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show how many records would be migrated without writing anything.',
        )
        parser.add_argument(
            '--user-id',
            type=str,
            default=None,
            help='Only migrate notifications for this specific user UUID.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        user_id = options['user_id']

        # ── Preflight checks ──────────────────────────────────────────────
        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured or could not be initialised.\n'
                'Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and '
                'FIREBASE_CLIENT_EMAIL in your environment and try again.'
            ))
            return

        from notifications.models import InAppNotification
        from notifications.firestore_service import migrate_from_postgres

        qs = InAppNotification.objects.select_related('recipient', 'actor').order_by('created_at')
        if user_id:
            qs = qs.filter(recipient_id=user_id)

        total = qs.count()
        self.stdout.write(f'Found {total} notification(s) to migrate.')

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'Dry run — no data written. Would migrate {total} notification(s).'
            ))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        # ── Run migration ─────────────────────────────────────────────────
        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} notification(s) written to Firestore.\n\n'
            'Next steps:\n'
            '  1. Verify the data in Firebase Console → Firestore → notifications\n'
            '  2. Set FS_NOTIFICATIONS=True in your Render environment variables\n'
            '  3. Redeploy — new notifications will now be stored in Firestore\n'
            '  4. The PostgreSQL InAppNotification table is kept as a backup\n'
            '     until you are confident everything works correctly.'
        ))
