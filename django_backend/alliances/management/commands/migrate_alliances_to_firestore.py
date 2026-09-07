"""
Management command: migrate_alliances_to_firestore
===================================================
Copies Alliance + AllianceMembership + AllianceEvent rows from PostgreSQL
into Firestore.  Run ONCE if you have existing data in the database.

Note: alliance views were always TODO stubs so most deployments will have
zero rows — the migration is a safety net for any data that was seeded
directly via the Django admin or management commands.

Usage:
    python manage.py migrate_alliances_to_firestore
    python manage.py migrate_alliances_to_firestore --dry-run
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate Alliance data from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview without writing.')

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from alliances.models import Alliance
        from alliances.firestore_alliance_service import migrate_from_postgres

        qs = Alliance.objects.prefetch_related(
            'members__user', 'events__user'
        ).select_related('leader')

        total = qs.count()
        self.stdout.write(f'Found {total} alliance(s) to migrate.')

        if dry_run:
            self.stdout.write(self.style.WARNING(f'Dry run — would migrate {total}.'))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS(
                'Nothing to migrate — alliances will be created directly in Firestore going forward.'
            ))
            return

        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} document(s) written to Firestore.\n\n'
            'Before using the alliance endpoints, create these Firestore indexes\n'
            '(Firebase Console → Firestore → Indexes → Composite):\n\n'
            '  Collection: alliances\n'
            '  Index 1: is_public ASC, total_prestige DESC\n'
            '  Index 2: total_prestige DESC  (single-field)\n\n'
            '  Collection: alliance_invitations\n'
            '  Index: invited_user_id ASC, status ASC, created_at DESC\n\n'
            '  Collection group: members\n'
            '  Index: user_id ASC, status ASC  (needed for get_user_alliance)\n\n'
            '  1. Set FS_ALLIANCES=True in Render env vars\n'
            '  2. Redeploy'
        ))
