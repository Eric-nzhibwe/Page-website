"""
Migration: Add security fields to User + PasswordResetToken + LoginHistory tables.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
    ]

    operations = [
        # ── New User columns ──────────────────────────────────────────────────
        migrations.AddField(
            model_name='user',
            name='failed_login_attempts',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='user',
            name='locked_until',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='password_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='last_login_ip',
            field=models.GenericIPAddressField(blank=True, null=True),
        ),

        # ── PasswordResetToken ────────────────────────────────────────────────
        migrations.CreateModel(
            name='PasswordResetToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name='ID')),
                ('token',      models.CharField(max_length=64, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('expires_at', models.DateTimeField()),
                ('used',       models.BooleanField(default=False)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='password_reset_tokens',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'password_reset_tokens'},
        ),

        # ── LoginHistory ──────────────────────────────────────────────────────
        migrations.CreateModel(
            name='LoginHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name='ID')),
                ('identifier', models.CharField(max_length=255)),
                ('status', models.CharField(
                    choices=[
                        ('success',    'Success'),
                        ('failed',     'Failed — bad credentials'),
                        ('locked',     'Failed — account locked'),
                        ('unverified', 'Failed — email not verified'),
                    ],
                    max_length=20,
                )),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, max_length=512)),
                ('location',   models.CharField(blank=True, max_length=255)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('user', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='login_history',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'login_history', 'ordering': ['-created_at']},
        ),
        migrations.AddIndex(
            model_name='loginhistory',
            index=models.Index(fields=['user', '-created_at'], name='lh_user_idx'),
        ),
        migrations.AddIndex(
            model_name='loginhistory',
            index=models.Index(fields=['ip_address', '-created_at'], name='lh_ip_idx'),
        ),
    ]
