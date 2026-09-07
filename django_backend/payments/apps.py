"""
Payments app configuration
"""
from django.apps import AppConfig


class PaymentsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'payments'
    verbose_name = 'Payments'

    def ready(self):
        # Register signals that mirror wallet/transaction data to Firestore
        # for fast read-only display. All financial writes stay in PostgreSQL.
        import payments.signals  # noqa: F401
