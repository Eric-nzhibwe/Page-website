"""
Users app configuration
"""
from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'users'
    verbose_name = 'Users'

    def ready(self):
        # Register signals that mirror profile data to Firestore.
        # Import is deferred to ready() so Django's model registry is fully
        # loaded before the signal receivers are connected.
        import users.signals  # noqa: F401
