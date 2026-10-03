"""
Management command: sync_users_to_firestore

Bulk-copies all active users from PostgreSQL to Firestore user_profiles.
Run this once after deploy to populate the backup, then it stays current
automatically because login/register now calls sync_user() every time.

Usage:
    python manage.py sync_users_to_firestore
    python manage.py sync_users_to_firestore --limit 100   # first 100 only
    python manage.py sync_users_to_firestore --force       # overwrite even recent docs
"""
import logging
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User   = get_user_model()


class Command(BaseCommand):
    help = 'Bulk-sync all PostgreSQL users to Firestore user_profiles collection.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=0,
                            help='Max users to sync (0 = all)')
        parser.add_argument('--force', action='store_true',
                            help='Overwrite existing Firestore docs')

    def handle(self, *args, **options):
        from page_platform.firebase_client import firebase_enabled
        if not firebase_enabled():
            self.stdout.write(self.style.ERROR(
                'Firebase is not configured — set FIREBASE_* env vars first.'
            ))
            return

        from users.firestore_user_service import sync_user
        qs = User.objects.filter(is_active=True).order_by('id')

        limit = options['limit']
        if limit:
            qs = qs[:limit]

        total   = qs.count() if not limit else min(limit, User.objects.filter(is_active=True).count())
        success = 0
        failed  = 0

        self.stdout.write(f'Syncing {total} users to Firestore…')

        for user in qs.iterator():
            ok = sync_user(user)
            if ok:
                success += 1
            else:
                failed += 1
                self.stdout.write(self.style.WARNING(f'  ✗ Failed: {user.username} ({user.id})'))

            if success % 50 == 0 and success > 0:
                self.stdout.write(f'  … {success}/{total} synced')

        self.stdout.write(self.style.SUCCESS(
            f'Done — {success} synced, {failed} failed.'
        ))
