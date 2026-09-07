"""
Management command: migrate_users_to_firestore
===============================================
Copies PUBLIC profile data for all active users from PostgreSQL into
Firestore.  Run this ONCE before flipping FS_USERS=True.

⚠️  Security reminder: this command NEVER writes passwords, tokens, OTP
    codes, email addresses, or any other sensitive auth data to Firestore.
    Only the profile fields defined in firestore_user_service._user_to_doc()
    are written.

Usage:
    python manage.py migrate_users_to_firestore
    python manage.py migrate_users_to_firestore --dry-run
    python manage.py migrate_users_to_firestore --active-only
"""
from django.core.management.base import BaseCommand
from artx_platform.firebase_client import firebase_enabled


class Command(BaseCommand):
    help = 'Mirror public user profiles from PostgreSQL to Firestore.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true',
                            help='Preview without writing.')
        parser.add_argument('--active-only', action='store_true',
                            default=True,
                            help='Only migrate active users (default: True).')

    def handle(self, *args, **options):
        dry_run     = options['dry_run']
        active_only = options['active_only']

        if not firebase_enabled():
            self.stderr.write(self.style.ERROR(
                'Firebase is not configured. Set FIREBASE_PROJECT_ID, '
                'FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL and retry.'
            ))
            return

        from users.models import User
        from users.firestore_user_service import migrate_from_postgres

        qs = User.objects.all()
        if active_only:
            qs = qs.filter(is_active=True)

        total = qs.count()
        self.stdout.write(f'Found {total} user(s) to migrate.')
        self.stdout.write(
            self.style.WARNING(
                'NOTE: Only public profile fields are written — '
                'passwords and tokens are NEVER sent to Firestore.'
            )
        )

        if dry_run:
            self.stdout.write(self.style.WARNING(
                f'Dry run — would migrate {total} user profile(s).'
            ))
            return

        if total == 0:
            self.stdout.write(self.style.SUCCESS('Nothing to migrate.'))
            return

        self.stdout.write('Migrating…')
        migrated = migrate_from_postgres(qs)

        self.stdout.write(self.style.SUCCESS(
            f'\nDone — {migrated} profile(s) written to Firestore.\n\n'
            'Before flipping the flag, create these Firestore indexes\n'
            '(Firebase Console → Firestore → Indexes):\n\n'
            '  user_profiles → prestige_points DESC  (single-field, auto-created)\n'
            '  user_profiles → access_tier ASC, prestige_points DESC  (composite)\n\n'
            'Then:\n'
            '  1. Verify in Firebase Console → Firestore → user_profiles\n'
            '  2. Set FS_USERS=True in Render env vars\n'
            '  3. Redeploy — every subsequent User.save() will automatically\n'
            '     keep the Firestore profile in sync via the post_save signal.\n'
            '  4. PostgreSQL users table stays as the auth source — never removed.'
        ))
