"""
Apps configuration for challenges
"""
from django.apps import AppConfig


class ChallengesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'challenges'
    verbose_name = 'Challenges'
    
    def ready(self):
        """Import signals when app is ready"""
        import challenges.signals
