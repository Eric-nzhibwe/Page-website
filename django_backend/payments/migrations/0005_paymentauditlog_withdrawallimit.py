"""
Migration: Add PaymentAuditLog and WithdrawalLimit tables.
"""
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0004_rename_transaction_wallet__idx_transaction_wallet__efd4a5_idx_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── PaymentAuditLog ───────────────────────────────────────────────────
        migrations.CreateModel(
            name='PaymentAuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name='ID')),
                ('action', models.CharField(
                    choices=[
                        ('initiated',       'Initiated'),
                        ('processing',      'Processing'),
                        ('completed',       'Completed'),
                        ('failed',          'Failed'),
                        ('cancelled',       'Cancelled'),
                        ('refunded',        'Refunded'),
                        ('webhook_received','Webhook Received'),
                        ('wallet_credited', 'Wallet Credited'),
                        ('wallet_debited',  'Wallet Debited'),
                        ('refund_issued',   'Refund Issued'),
                    ],
                    max_length=30,
                )),
                ('previous_status', models.CharField(blank=True, max_length=20)),
                ('new_status',      models.CharField(blank=True, max_length=20)),
                ('amount',    models.DecimalField(decimal_places=2, max_digits=10, null=True, blank=True)),
                ('currency',  models.CharField(blank=True, max_length=3)),
                ('provider',  models.CharField(blank=True, max_length=20)),
                ('ip_address',models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent',models.CharField(blank=True, max_length=512)),
                ('metadata',  models.JSONField(blank=True, default=dict)),
                ('note',      models.TextField(blank=True)),
                ('created_at',models.DateTimeField(auto_now_add=True, db_index=True)),
                ('payment', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='audit_logs',
                    to='payments.payment',
                )),
                ('withdrawal', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='audit_logs',
                    to='payments.withdrawal',
                )),
                ('user', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='payment_audit_logs',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'payment_audit_logs', 'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='paymentauditlog',
            index=models.Index(fields=['payment', '-created_at'], name='audit_payment_idx'),
        ),
        migrations.AddIndex(
            model_name='paymentauditlog',
            index=models.Index(fields=['withdrawal', '-created_at'], name='audit_withdrawal_idx'),
        ),
        migrations.AddIndex(
            model_name='paymentauditlog',
            index=models.Index(fields=['user', '-created_at'], name='audit_user_idx'),
        ),
        migrations.AddIndex(
            model_name='paymentauditlog',
            index=models.Index(fields=['action'], name='audit_action_idx'),
        ),

        # ── WithdrawalLimit ───────────────────────────────────────────────────
        migrations.CreateModel(
            name='WithdrawalLimit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name='ID')),
                ('daily_limit', models.DecimalField(
                    decimal_places=2, default=Decimal('5000.00'), max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0.00'))],
                )),
                ('monthly_limit', models.DecimalField(
                    decimal_places=2, default=Decimal('50000.00'), max_digits=10,
                    validators=[django.core.validators.MinValueValidator(Decimal('0.00'))],
                )),
                ('currency',   models.CharField(default='ZMW', max_length=3)),
                ('is_active',  models.BooleanField(default=True)),
                ('note',       models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='withdrawal_limit',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'withdrawal_limits'},
        ),
    ]
