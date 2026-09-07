"""
Management command: migrate_chatbot_to_firestore
=================================================
Copies all existing ChatConversation + ChatMessage rows from PostgreSQL
into Firestore sub-collections.
Run this ONCE before flipping FS_CHATBOT=True in your env.

Usage:
    python manage.py migrate_chatbot_to_firestore
    python manage.py migrate_chatbot_to_firestore --dry-run
    python manage.py migrate_chatbot_to_firestore --user-id <uuid>
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Migrate ChatConversation + ChatMessage rows from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show counts without writing anything.',
        )
        parser.add_argument(
            '--user-id',
            type=str,
            default=None,
            help='Only migrate conversations for this specific user UUID.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        user_id = options['user_id']

        # ── Preflight ─────────────────────────────────────────────────────────
        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured or could not be initialised.\n'
                'Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and '
                'FIREBASE_CLIENT_EMAIL in your environment and try again.'
            ))
            return

        from chatbot.models import ChatConversation
        from chatbot.firestore_chat_service import migrate_from_postgres

        qs = ChatConversation.objects.prefetch_related('messages').select_related('user')
        if user_id:
            qs = qs.filter(user_id=user_id)

        conv_count = qs.count()
        msg_count  = sum(c.messages.count() for c in qs)

        self.stdout.write(
            f'Found {conv_count} conversation(s) / {msg_count} message(s) to migrate.'
        )

        if dry_run:
            self.stdout.write(self.style.WARNING(
                'Dry run — no data written.'
            ))
            return

        if conv_count == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        written = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {written} total documents written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore indexes:\n'
            '  Firebase Console → Firestore → Indexes → Composite → Add index\n\n'
            '  Collection: chat_conversations\n'
            '  Index: user_id ASC, updated_at DESC\n\n'
            '  The messages sub-collection is auto-indexed on created_at.\n\n'
            'Then:\n'
            '  1. Verify data in Firebase Console → Firestore → chat_conversations\n'
            '  2. Set FS_CHATBOT=True in your Render environment variables\n'
            '  3. Redeploy — new conversations will now be stored in Firestore\n'
            '  4. PostgreSQL tables kept as backup until verified.'
        ))
