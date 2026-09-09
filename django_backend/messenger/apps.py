from django.apps import AppConfig


class MessengerConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'messenger'

    def ready(self):
        # Register post_save signals that mirror messages to Firestore
        import messenger.signals  # noqa: F401
