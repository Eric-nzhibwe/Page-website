"""
Management command to seed sample challenges
"""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from challenges.models import Challenge


class Command(BaseCommand):
    help = 'Seed sample challenges into the database'

    def handle(self, *args, **options):
        # Check if challenges already exist
        if Challenge.objects.exists():
            self.stdout.write(self.style.WARNING('Challenges already exist. Skipping seed.'))
            return

        sample_challenges = [
            {
                'title': 'The Forgotten Garden',
                'difficulty': 'easy',
                'time_limit': 15,
                'description': 'Interpret this serene garden scene. What stories does it tell? What emotions does it evoke?',
                'image_url': 'https://images.unsplash.com/photo-1469022563149-aa64dbd37dae?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Write a creative interpretation of the garden',
                    'Focus on emotions and atmosphere',
                    'Be original and thoughtful',
                    'No plagiarism or copied content'
                ],
                'min_word_count': 50,
                'max_word_count': 200,
                'creativity_weight': 40,
                'relevance_weight': 35,
                'detail_weight': 25,
                'min_points': 10,
                'max_points': 30,
                'starts_at': timezone.now() - timedelta(days=7),
                'ends_at': timezone.now() + timedelta(days=3),
            },
            {
                'title': 'Urban Chaos',
                'difficulty': 'medium',
                'time_limit': 20,
                'description': 'Capture the essence of a bustling city. What makes urban life unique? Describe the energy, the people, the movement.',
                'image_url': 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Describe the urban landscape in detail',
                    'Include sensory details (sounds, sights, smells)',
                    'Reflect on the human element',
                    'Show understanding of city dynamics'
                ],
                'min_word_count': 100,
                'max_word_count': 300,
                'creativity_weight': 35,
                'relevance_weight': 40,
                'detail_weight': 25,
                'min_points': 30,
                'max_points': 60,
                'starts_at': timezone.now() - timedelta(days=5),
                'ends_at': timezone.now() + timedelta(days=5),
            },
            {
                'title': 'Nature\'s Masterpiece',
                'difficulty': 'medium',
                'time_limit': 25,
                'description': 'Explore the beauty and complexity of nature. What can we learn from natural patterns and forms?',
                'image_url': 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Analyze the natural elements present',
                    'Discuss patterns and symmetry',
                    'Connect to broader environmental themes',
                    'Show deep observation skills'
                ],
                'min_word_count': 120,
                'max_word_count': 350,
                'creativity_weight': 30,
                'relevance_weight': 40,
                'detail_weight': 30,
                'min_points': 30,
                'max_points': 60,
                'starts_at': timezone.now() - timedelta(days=3),
                'ends_at': timezone.now() + timedelta(days=7),
            },
            {
                'title': 'Abstract Emotions',
                'difficulty': 'hard',
                'time_limit': 30,
                'description': 'This abstract composition challenges your perception. What emotions, concepts, or ideas does it represent?',
                'image_url': 'https://images.unsplash.com/photo-1549887534-7e9b4d0e5f5f?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Provide a thoughtful interpretation of abstract elements',
                    'Explain your reasoning and perspective',
                    'Connect abstract forms to concrete concepts',
                    'Demonstrate critical thinking'
                ],
                'min_word_count': 150,
                'max_word_count': 400,
                'creativity_weight': 45,
                'relevance_weight': 30,
                'detail_weight': 25,
                'min_points': 60,
                'max_points': 100,
                'starts_at': timezone.now() - timedelta(days=2),
                'ends_at': timezone.now() + timedelta(days=10),
            },
            {
                'title': 'The Human Condition',
                'difficulty': 'hard',
                'time_limit': 35,
                'description': 'A powerful portrait that speaks volumes. What does this image reveal about human experience, identity, or connection?',
                'image_url': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Analyze the human elements and expressions',
                    'Discuss broader themes of identity or connection',
                    'Show empathy and cultural awareness',
                    'Provide nuanced interpretation'
                ],
                'min_word_count': 150,
                'max_word_count': 450,
                'creativity_weight': 35,
                'relevance_weight': 40,
                'detail_weight': 25,
                'min_points': 60,
                'max_points': 100,
                'starts_at': timezone.now() - timedelta(days=1),
                'ends_at': timezone.now() + timedelta(days=12),
            },
            {
                'title': 'Mastery of Vision',
                'difficulty': 'expert',
                'time_limit': 45,
                'description': 'An intricate composition that demands deep analysis. Synthesize multiple perspectives and create a comprehensive interpretation.',
                'image_url': 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=500&h=300&fit=crop',
                'submission_rules': [
                    'Provide comprehensive multi-layered analysis',
                    'Integrate multiple interpretive frameworks',
                    'Demonstrate advanced critical thinking',
                    'Show mastery of artistic concepts',
                    'Connect to broader cultural or philosophical themes'
                ],
                'min_word_count': 250,
                'max_word_count': 600,
                'creativity_weight': 40,
                'relevance_weight': 35,
                'detail_weight': 25,
                'min_points': 100,
                'max_points': 200,
                'starts_at': timezone.now(),
                'ends_at': timezone.now() + timedelta(days=14),
            }
        ]

        created_count = 0
        for challenge_data in sample_challenges:
            challenge, created = Challenge.objects.get_or_create(
                title=challenge_data['title'],
                defaults={
                    **challenge_data,
                    'status': 'active',
                }
            )
            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'Created challenge: {challenge.title}'))

        self.stdout.write(self.style.SUCCESS(f'\nSuccessfully created {created_count} challenges'))
