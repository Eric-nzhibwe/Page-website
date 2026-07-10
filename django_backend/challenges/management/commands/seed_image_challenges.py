"""
Management command to seed sample Image Interpretation challenges.

Usage:
    python manage.py seed_image_challenges
    python manage.py seed_image_challenges --force   # re-seed even if records exist
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from challenges.models import Challenge


# ---------------------------------------------------------------------------
# Sample image interpretation challenges
# Each "hidden_points" list is the answer key — kept secret from participants.
# accepted_meanings uses semantic keywords the AI scorer looks for.
# ---------------------------------------------------------------------------
IMAGE_CHALLENGES = [
    {
        'title': 'Echoes of Time',
        'difficulty': 'easy',
        'time_limit': 2,       # minutes
        'description': (
            'A hauntingly beautiful scene full of symbolism. '
            'How many hidden meanings can you uncover?'
        ),
        'image_url': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=500&fit=crop',
        'hidden_points': [
            {
                'label': 'Misty mountain',
                'accepted_meanings': ['obstacles', 'ambition', 'journey', 'challenge', 'perseverance', 'the unknown'],
            },
            {
                'label': 'Lone tree',
                'accepted_meanings': ['isolation', 'resilience', 'solitude', 'strength', 'loneliness', 'survival'],
            },
            {
                'label': 'Fading light',
                'accepted_meanings': ['hope', 'end of a journey', 'transition', 'sunset', 'opportunity passing', 'time'],
            },
            {
                'label': 'Empty path',
                'accepted_meanings': ['choice', 'direction', 'future', 'life journey', 'uncertainty', 'freedom'],
            },
        ],
        'submission_rules': ['Observe carefully', 'Explain each element you find', 'Write the overall story'],
        'min_word_count': 10,
        'max_word_count': 1000,
        'creativity_weight': 40,
        'relevance_weight': 35,
        'detail_weight': 25,
        'min_points': 20,
        'max_points': 60,
        'prize_amount': 0,
        'entry_fee': 0,
        'starts_at': timezone.now() - timedelta(hours=1),
        'ends_at': timezone.now() + timedelta(days=7),
    },
    {
        'title': 'The Weight of Memory',
        'difficulty': 'medium',
        'time_limit': 3,
        'description': (
            'An evocative image layered with emotional depth. '
            'Discover the hidden visual elements and decode the story they tell together.'
        ),
        'image_url': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=500&fit=crop',
        'hidden_points': [
            {
                'label': 'Tired eyes',
                'accepted_meanings': ['exhaustion', 'sadness', 'wisdom', 'heavy burden', 'life experience', 'grief'],
            },
            {
                'label': 'Lines on the face',
                'accepted_meanings': ['age', 'time passing', 'experience', 'hardship', 'story', 'resilience'],
            },
            {
                'label': 'Downward gaze',
                'accepted_meanings': ['shame', 'reflection', 'loss', 'introspection', 'regret', 'humility'],
            },
            {
                'label': 'Muted colours',
                'accepted_meanings': ['sadness', 'nostalgia', 'bleakness', 'grief', 'faded hope', 'the past'],
            },
            {
                'label': 'Strong jaw',
                'accepted_meanings': ['determination', 'stubbornness', 'resilience', 'endurance', 'dignity'],
            },
        ],
        'submission_rules': ['Identify at least 3 visual elements', 'Interpret each one', 'Summarise the overall message'],
        'min_word_count': 10,
        'max_word_count': 1000,
        'creativity_weight': 35,
        'relevance_weight': 40,
        'detail_weight': 25,
        'min_points': 40,
        'max_points': 90,
        'prize_amount': 0,
        'entry_fee': 0,
        'starts_at': timezone.now() - timedelta(hours=2),
        'ends_at': timezone.now() + timedelta(days=10),
    },
    {
        'title': 'Concrete Jungle',
        'difficulty': 'medium',
        'time_limit': 3,
        'description': (
            'A city image teeming with symbols of modern life. '
            'How many layers of meaning can you find?'
        ),
        'image_url': 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800&h=500&fit=crop',
        'hidden_points': [
            {
                'label': 'Towering skyscrapers',
                'accepted_meanings': ['ambition', 'power', 'wealth inequality', 'modern progress', 'corporate dominance'],
            },
            {
                'label': 'Tiny pedestrians',
                'accepted_meanings': ['insignificance', 'individuality lost', 'the human scale', 'community', 'daily life'],
            },
            {
                'label': 'Gridded streets',
                'accepted_meanings': ['order', 'control', 'systematic society', 'structure', 'conformity'],
            },
            {
                'label': 'Smoggy sky',
                'accepted_meanings': ['pollution', 'environmental cost of progress', 'obscured future', 'industry'],
            },
            {
                'label': 'Neon signs',
                'accepted_meanings': ['consumerism', 'distraction', 'desire', 'commercialism', 'entertainment culture'],
            },
            {
                'label': 'Empty park in the background',
                'accepted_meanings': ['nature displaced', 'forgotten tranquility', 'contrast', 'escape', 'nostalgia'],
            },
        ],
        'submission_rules': ['Look at foreground and background', 'Consider scale and contrast', 'Write the cityʼs story'],
        'min_word_count': 10,
        'max_word_count': 1000,
        'creativity_weight': 30,
        'relevance_weight': 40,
        'detail_weight': 30,
        'min_points': 40,
        'max_points': 90,
        'prize_amount': 50,
        'entry_fee': 5,
        'starts_at': timezone.now() - timedelta(hours=3),
        'ends_at': timezone.now() + timedelta(days=7),
    },
    {
        'title': 'Roots and Ruins',
        'difficulty': 'hard',
        'time_limit': 4,
        'description': (
            'An abandoned structure reclaimed by nature. '
            'Every crack, vine, and shadow tells part of a deeper story. '
            'Find as many hidden points as you can.'
        ),
        'image_url': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=500&fit=crop',
        'hidden_points': [
            {
                'label': 'Crumbling walls',
                'accepted_meanings': ['decay', 'passage of time', 'impermanence', 'the end of an era', 'neglect'],
            },
            {
                'label': 'Vines growing over ruins',
                'accepted_meanings': ['nature reclaiming', 'life persisting', 'resilience', 'growth', 'healing'],
            },
            {
                'label': 'Broken window',
                'accepted_meanings': ['vulnerability', 'abandoned hope', 'shattered dreams', 'entry and exit', 'exposure'],
            },
            {
                'label': 'Sunlight through the ceiling gap',
                'accepted_meanings': ['hope', 'divine light', 'beauty in decay', 'renewal', 'opportunity'],
            },
            {
                'label': 'Moss on the floor',
                'accepted_meanings': ['slow passage of time', 'life in unlikely places', 'persistence', 'quiet growth'],
            },
            {
                'label': 'Absence of people',
                'accepted_meanings': ['abandonment', 'loneliness', 'end of civilisation', 'solitude', 'ghost town'],
            },
            {
                'label': 'Contrast of old stonework and new growth',
                'accepted_meanings': ['past vs present', 'nature vs man', 'cycle of life', 'duality', 'renewal'],
            },
        ],
        'submission_rules': [
            'Look at structure, nature, light, and absence',
            'Interpret each visual metaphor',
            'Describe the tension between decay and growth',
        ],
        'min_word_count': 10,
        'max_word_count': 1000,
        'creativity_weight': 40,
        'relevance_weight': 35,
        'detail_weight': 25,
        'min_points': 70,
        'max_points': 140,
        'prize_amount': 100,
        'entry_fee': 10,
        'starts_at': timezone.now() - timedelta(hours=1),
        'ends_at': timezone.now() + timedelta(days=14),
    },
    {
        'title': 'The Garden of Choices',
        'difficulty': 'expert',
        'time_limit': 5,
        'description': (
            'A complex composition where nothing is accidental. '
            'Every colour, shadow, and placement carries intentional meaning. '
            'This challenge separates casual observers from true readers of imagery.'
        ),
        'image_url': 'https://images.unsplash.com/photo-1469022563149-aa64dbd37dae?w=800&h=500&fit=crop',
        'hidden_points': [
            {
                'label': 'Two diverging paths',
                'accepted_meanings': ['choice', 'life decisions', 'fork in the road', 'diverging futures', 'dilemma'],
            },
            {
                'label': 'Overgrown side path',
                'accepted_meanings': ['road less travelled', 'the unknown', 'risk', 'wild possibility', 'neglect'],
            },
            {
                'label': 'Well-worn main path',
                'accepted_meanings': ['conformity', 'safety', 'social expectation', 'tradition', 'the easy route'],
            },
            {
                'label': 'Golden light at the end',
                'accepted_meanings': ['reward', 'hope', 'destination', 'success', 'enlightenment', 'the goal'],
            },
            {
                'label': 'Overhanging branches forming an arch',
                'accepted_meanings': ['threshold', 'transition', 'entering a new chapter', 'protection', 'gateway'],
            },
            {
                'label': 'Single flower off to one side',
                'accepted_meanings': ['beauty in unexpected places', 'uniqueness', 'reward for looking', 'individuality'],
            },
            {
                'label': 'Shadows on the ground',
                'accepted_meanings': ['fear', 'the unconscious', 'things unseen', 'doubt', 'hidden obstacles'],
            },
            {
                'label': 'Symmetry of the garden layout',
                'accepted_meanings': ['order', 'deliberate design', 'balance', 'human control over nature'],
            },
        ],
        'submission_rules': [
            'Identify both obvious and subtle elements',
            'Explain symbolic significance of each',
            'Connect them into a coherent narrative',
            'Discuss the overall philosophy the image presents',
        ],
        'min_word_count': 10,
        'max_word_count': 1000,
        'creativity_weight': 40,
        'relevance_weight': 35,
        'detail_weight': 25,
        'min_points': 100,
        'max_points': 220,
        'prize_amount': 200,
        'entry_fee': 20,
        'starts_at': timezone.now(),
        'ends_at': timezone.now() + timedelta(days=21),
    },
]


class Command(BaseCommand):
    help = 'Seed sample Image Interpretation challenges into the database'

    def add_arguments(self, parser):
        parser.add_argument(
            '--force',
            action='store_true',
            help='Re-seed even if image interpretation challenges already exist',
        )

    def handle(self, *args, **options):
        existing = Challenge.objects.filter(challenge_type='image_interpretation').count()

        if existing and not options['force']:
            self.stdout.write(
                self.style.WARNING(
                    f'{existing} image interpretation challenge(s) already exist. '
                    'Use --force to re-seed.'
                )
            )
            return

        created_count = 0
        for data in IMAGE_CHALLENGES:
            challenge, created = Challenge.objects.get_or_create(
                title=data['title'],
                challenge_type='image_interpretation',
                defaults={
                    **data,
                    'status': 'active',
                    'challenge_type': 'image_interpretation',
                },
            )
            if created:
                created_count += 1
                pts_count = len(data.get('hidden_points', []))
                self.stdout.write(
                    self.style.SUCCESS(
                        f'  ✓ Created: "{challenge.title}" '
                        f'({data["difficulty"]}, {pts_count} hidden points, '
                        f'K{data["entry_fee"]} entry, K{data["prize_amount"]} prize)'
                    )
                )
            else:
                self.stdout.write(self.style.WARNING(f'  · Already exists: "{challenge.title}"'))

        self.stdout.write(
            self.style.SUCCESS(f'\nDone — {created_count} image interpretation challenge(s) created.')
        )
