"""
Management command: migrate_social_to_firestore
================================================
Copies Post + Comment + PostReaction rows from PostgreSQL to Firestore.
Run ONCE before flipping FS_SOCIAL=True.

Usage:
    python manage.py migrate_social_to_firestore
    python manage.py migrate_social_to_firestore --dry-run
    python manage.py migrate_social_to_firestore --user-id <uuid>
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate social posts (+ comments + reactions) from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview without writing.')
        parser.add_argument('--user-id', type=str, default=None,
                            help='Only migrate posts by this user UUID.')

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        user_id = options['user_id']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from social.models import Post
        from social.firestore_social_service import migrate_from_postgres

        qs = Post.objects.select_related('author').prefetch_related(
            'comments__author', 'reactions__user'
        )
        if user_id:
            qs = qs.filter(author_id=user_id)

        post_count    = qs.count()
        comment_count = sum(p.comments.count() for p in qs)
        react_count   = sum(p.reactions.count() for p in qs)

        self.stdout.write(
            f'Found {post_count} post(s), {comment_count} comment(s), '
            f'{react_count} reaction(s) to migrate.'
        )

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry run — no data written.'))
            return

        if post_count == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} document(s) written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore indexes\n'
            '(Firebase Console → Firestore → Indexes → Composite):\n\n'
            '  Collection: social_posts\n'
            '  Index 1: author_id ASC, created_at DESC\n'
            '  Index 2: created_at DESC  (single-field, auto-created)\n\n'
            'Then:\n'
            '  1. Verify in Firebase Console → Firestore → social_posts\n'
            '  2. Set FS_SOCIAL=True in Render env vars\n'
            '  3. Redeploy\n'
            '  4. PostgreSQL tables kept as backup until verified.'
        ))
