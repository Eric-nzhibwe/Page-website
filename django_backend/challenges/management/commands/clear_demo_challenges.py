"""
Management command to delete all seeded demo challenges from the database.
Run once: python manage.py clear_demo_challenges
"""
from django.core.management.base import BaseCommand
from challenges.models import Challenge

DEMO_TITLES = [
    'The Forgotten Garden',
    'Urban Chaos',
    "Nature's Masterpiece",
    'Abstract Emotions',
    'The Human Condition',
    'Mastery of Vision',
]


class Command(BaseCommand):
    help = 'Remove all seeded demo challenges from the database.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--all',
            action='store_true',
            help='Delete ALL challenges, not just the known demo ones.',
        )

    def handle(self, *args, **options):
        if options['all']:
            count, _ = Challenge.objects.all().delete()
            self.stdout.write(self.style.SUCCESS(f'Deleted all {count} challenges.'))
        else:
            count, _ = Challenge.objects.filter(title__in=DEMO_TITLES).delete()
            self.stdout.write(
                self.style.SUCCESS(f'Deleted {count} demo challenge(s).')
                if count
                else self.style.WARNING('No demo challenges found — already clean.')
            )
