"""
Management command: migrate_submissions_to_firestore
=====================================================
Copies ChallengeSubmission and ImageInterpretationSubmission rows from
PostgreSQL into the Firestore 'challenge_submissions' collection.
Run this ONCE before flipping FS_SUBMISSIONS=True in your env.

Usage:
    python manage.py migrate_submissions_to_firestore
    python manage.py migrate_submissions_to_firestore --dry-run
    python manage.py migrate_submissions_to_firestore --type text
    python manage.py migrate_submissions_to_firestore --type image
    python manage.py migrate_submissions_to_firestore --user-id <uuid>
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate challenge submissions from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview without writing.')
        parser.add_argument('--type', choices=['text', 'image', 'both'],
                            default='both', dest='sub_type',
                            help='Which submission type to migrate (default: both).')
        parser.add_argument('--user-id', type=str, default=None,
                            help='Only migrate submissions for this user UUID.')

    def handle(self, *args, **options):
        dry_run  = options['dry_run']
        sub_type = options['sub_type']
        user_id  = options['user_id']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from challenges.models import ChallengeSubmission, ImageInterpretationSubmission
        from challenges.firestore_submission_service import (
            migrate_text_submissions, migrate_image_submissions
        )

        text_qs = ChallengeSubmission.objects.select_related('challenge', 'user')
        img_qs  = ImageInterpretationSubmission.objects.select_related('challenge', 'user')

        if user_id:
            text_qs = text_qs.filter(user_id=user_id)
            img_qs  = img_qs.filter(user_id=user_id)

        text_count = text_qs.count() if sub_type in ('text', 'both') else 0
        img_count  = img_qs.count()  if sub_type in ('image', 'both') else 0
        total      = text_count + img_count

        self.stdout.write(
            f'Found {text_count} text submission(s) and {img_count} image submission(s).'
        )

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'Dry run — would migrate {total} total submission(s).'
            ))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        migrated = 0

        if sub_type in ('text', 'both') and text_count:
            migrated += migrate_text_submissions(text_qs)

        if sub_type in ('image', 'both') and img_count:
            migrated += migrate_image_submissions(img_qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} submission document(s) written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore composite indexes\n'
            '(Firebase Console → Firestore → Indexes → Composite):\n\n'
            '  Collection: challenge_submissions\n'
            '  Index 1: user_id ASC, submitted_at DESC\n'
            '  Index 2: challenge_id ASC, status ASC, final_score DESC\n'
            '  Index 3: challenge_id ASC, submitted_at DESC\n\n'
            'Then:\n'
            '  1. Verify in Firebase Console → Firestore → challenge_submissions\n'
            '  2. Set FS_SUBMISSIONS=True in Render env vars\n'
            '  3. Redeploy — new submissions will now be stored in Firestore\n'
            '  4. PostgreSQL tables kept as backup until verified.'
        ))
