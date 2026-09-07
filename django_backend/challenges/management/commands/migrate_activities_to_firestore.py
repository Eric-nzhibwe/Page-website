"""
Management command: migrate_activities_to_firestore
=====================================================
Copies all existing ChallengeActivity rows from PostgreSQL into Firestore.
Run this ONCE before flipping FS_ACTIVITIES=True in your env.

Usage:
    python manage.py migrate_activities_to_firestore
    python manage.py migrate_activities_to_firestore --dry-run
    python manage.py migrate_activities_to_firestore --challenge-id <uuid>
    python manage.py migrate_activities_to_firestore --type submission
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate ChallengeActivity rows from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show how many records would be migrated without writing anything.',
        )
        parser.add_argument(
            '--challenge-id',
            type=str,
            default=None,
            help='Only migrate activities for this specific challenge UUID.',
        )
        parser.add_argument(
            '--type',
            type=str,
            default=None,
            dest='activity_type',
            help='Only migrate activities of this type (e.g. submission, score_update).',
        )

    def handle(self, *args, **options):
        dry_run       = options['dry_run']
        challenge_id  = options['challenge_id']
        activity_type = options['activity_type']

        # ── Preflight ─────────────────────────────────────────────────────────
        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured or could not be initialised.\n'
                'Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and '
                'FIREBASE_CLIENT_EMAIL in your environment and try again.'
            ))
            return

        from challenges.models import ChallengeActivity
        from challenges.firestore_activity_service import migrate_from_postgres

        qs = ChallengeActivity.objects.select_related(
            'challenge', 'user'
        ).order_by('created_at')

        if challenge_id:
            qs = qs.filter(challenge_id=challenge_id)
        if activity_type:
            qs = qs.filter(activity_type=activity_type)

        total = qs.count()
        self.stdout.write(f'Found {total} activity record(s) to migrate.')

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'Dry run — no data written. Would migrate {total} activity record(s).'
            ))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} activity record(s) written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore composite indexes:\n'
            '  Firebase Console → Firestore → Indexes → Composite → Add index\n\n'
            '  Collection: challenge_activities\n'
            '  Index 1: challenge_id ASC, created_at DESC\n'
            '  Index 2: created_at DESC  (single-field, enables global feed)\n\n'
            'Then:\n'
            '  1. Verify data in Firebase Console → Firestore → challenge_activities\n'
            '  2. Set FS_ACTIVITIES=True in your Render environment variables\n'
            '  3. Redeploy — new activities will now be stored in Firestore\n'
            '  4. PostgreSQL ChallengeActivity table kept as backup until verified.'
        ))
