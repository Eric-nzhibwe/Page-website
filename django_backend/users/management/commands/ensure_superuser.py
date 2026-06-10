"""
Management command: ensure_superuser

Creates a superuser from environment variables if one doesn't exist yet.
Safe to run on every deploy — does nothing if the user already exists.

Usage in build.sh:
    python manage.py ensure_superuser

Required env vars:
    DJANGO_SUPERUSER_EMAIL
    DJANGO_SUPERUSER_USERNAME
    DJANGO_SUPERUSER_PASSWORD
"""
import os
import logging
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()


class Command(BaseCommand):
    help = 'Create a superuser from env vars if none exists.'

    def handle(self, *args, **options):
        email    = os.environ.get('DJANGO_SUPERUSER_EMAIL', '').strip()
        username = os.environ.get('DJANGO_SUPERUSER_USERNAME', '').strip()
        password = os.environ.get('DJANGO_SUPERUSER_PASSWORD', '').strip()

        if not all([email, username, password]):
            self.stdout.write(self.style.WARNING(
                'ensure_superuser: skipped — '
                'DJANGO_SUPERUSER_EMAIL, DJANGO_SUPERUSER_USERNAME, '
                'and DJANGO_SUPERUSER_PASSWORD must all be set.'
            ))
            return

        if User.objects.filter(email__iexact=email).exists():
            self.stdout.write(self.style.SUCCESS(
                f'ensure_superuser: superuser {email} already exists, skipping.'
            ))
            return

        User.objects.create_superuser(
            username=username,
            email=email,
            password=password,
        )
        self.stdout.write(self.style.SUCCESS(
            f'ensure_superuser: created superuser {username} ({email})'
        ))
