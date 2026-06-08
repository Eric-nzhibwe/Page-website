import django.core.validators
import django.db.models.deletion
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('payments', '0002_alter_payment_provider'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Wallet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('available_balance', models.DecimalField(decimal_places=2, default=0, max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('pending_balance', models.DecimalField(decimal_places=2, default=0, max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('total_deposited', models.DecimalField(decimal_places=2, default=0, max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('total_withdrawn', models.DecimalField(decimal_places=2, default=0, max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('total_earned', models.DecimalField(decimal_places=2, default=0, max_digits=10, validators=[django.core.validators.MinValueValidator(Decimal('0.00'))])),
                ('currency', models.CharField(choices=[('USD', 'US Dollar'), ('KES', 'Kenyan Shilling'), ('UGX', 'Ugandan Shilling'), ('TZS', 'Tanzanian Shilling'), ('ZMW', 'Zambian Kwacha'), ('GHS', 'Ghanaian Cedi'), ('NGN', 'Nigerian Naira'), ('ZAR', 'South African Rand')], default='ZMW', max_length=3)),
                ('is_active', models.BooleanField(default=True)),
                ('is_locked', models.BooleanField(default=False)),
                ('lock_reason', models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='wallet', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'wallets',
            },
        ),
        migrations.CreateModel(
            name='Transaction',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('transaction_type', models.CharField(choices=[('deposit', 'Deposit'), ('withdrawal', 'Withdrawal'), ('earning', 'Game Earning'), ('payment', 'Payment'), ('refund', 'Refund'), ('bonus', 'Bonus'), ('fee', 'Fee'), ('transfer', 'Transfer')], max_length=20)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('balance_after', models.DecimalField(decimal_places=2, max_digits=10)),
                ('description', models.CharField(max_length=255)),
                ('metadata', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('wallet', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transactions', to='payments.wallet')),
                ('payment', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='wallet_transactions', to='payments.payment')),
                ('withdrawal', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='wallet_transactions', to='payments.withdrawal')),
            ],
            options={
                'db_table': 'transactions',
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='transaction',
            index=models.Index(fields=['wallet', '-created_at'], name='transaction_wallet__idx'),
        ),
        migrations.AddIndex(
            model_name='transaction',
            index=models.Index(fields=['transaction_type'], name='transaction_type_idx'),
        ),
    ]
