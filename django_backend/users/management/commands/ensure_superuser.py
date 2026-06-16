"""
Management command: ensure_superuser

Creates or updates a superuser from environment variables on every deploy.
Safe to run repeatedly — updates the password if the user already exists.

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
    help = 'Create or update a superuser from env vars on every deploy.'

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

        # Try to find existing user by email OR username
        user = None
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            pass

        if user is None:
            try:
                user = User.objects.get(username__iexact=username)
            except User.DoesNotExist:
                pass

        if user is not None:
            # Always sync password, staff/superuser flags, and username
            user.set_password(password)
            user.is_staff     = True
            user.is_superuser = True
            user.is_active    = True
            user.email        = email
            user.username     = username
            user.save()
            self.stdout.write(self.style.SUCCESS(
                f'ensure_superuser: updated superuser {username} ({email})'
            ))
        else:
            User.objects.create_superuser(
                username=username,
                email=email,
                password=password,
            )
            self.stdout.write(self.style.SUCCESS(
                f'ensure_superuser: created superuser {username} ({email})'
            ))
