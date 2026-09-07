"""
Management command: migrate_challenges_to_firestore
====================================================
Copies all existing Challenge rows from PostgreSQL into Firestore.
Run this ONCE before flipping FS_CHALLENGES=True in your env.

Usage:
    python manage.py migrate_challenges_to_firestore
    python manage.py migrate_challenges_to_firestore --dry-run
    python manage.py migrate_challenges_to_firestore --status active
    python manage.py migrate_challenges_to_firestore --type image_interpretation
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate Challenge rows from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run',  action='store_true',
                            help='Preview without writing anything.')
        parser.add_argument('--status',   type=str, default=None,
                            help='Only migrate challenges with this status.')
        parser.add_argument('--type',     type=str, default=None,
                            dest='challenge_type',
                            help='Only migrate challenges of this type.')

    def handle(self, *args, **options):
        dry_run        = options['dry_run']
        status_filter  = options['status']
        type_filter    = options['challenge_type']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from challenges.models import Challenge
        from challenges.firestore_challenge_service import migrate_from_postgres

        qs = Challenge.objects.select_related('created_by').all()
        if status_filter:
            qs = qs.filter(status=status_filter)
        if type_filter:
            qs = qs.filter(challenge_type=type_filter)

        total = qs.count()
        self.stdout.write(f'Found {total} challenge(s) to migrate.')

        if dry_run:
            self.stdout.write(self.style.WARNING(f'Dry run — would migrate {total}.'))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} challenge(s) written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore composite indexes\n'
            '(Firebase Console → Firestore → Indexes → Composite):\n\n'
            '  Collection: challenges\n'
            '  Index 1: status ASC, created_at DESC\n'
            '  Index 2: status ASC, starts_at ASC  (for active filtering)\n'
            '  Index 3: created_by_id ASC, created_at DESC\n'
            '  Index 4: is_featured ASC, status ASC, created_at DESC\n\n'
            'Then:\n'
            '  1. Verify in Firebase Console → Firestore → challenges\n'
            '  2. Set FS_CHALLENGES=True in Render env vars\n'
            '  3. Redeploy — new challenges will now be stored in Firestore\n'
            '  4. PostgreSQL Challenge table kept as backup until verified.'
        ))
