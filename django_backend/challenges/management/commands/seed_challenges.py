"""
Management command to seed sample challenges.
Demo data has been removed. Challenges are created through the admin panel or the API.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Previously seeded sample challenges. Demo data has been removed.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING(
            'Demo challenges have been removed. '
            'Create challenges via the Django admin panel or the API.'
        ))
