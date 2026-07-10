"""
Migration: Add Image Interpretation challenge support
"""
from django.db import migrations, models
import django.core.validators
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ('challenges', '0001_initial'),
    ]

    operations = [
        # ── Add new fields to Challenge ──────────────────────────────────────
        migrations.AddField(
            model_name='challenge',
            name='challenge_type',
            field=models.CharField(
                max_length=30,
                choices=[
                    ('text_interpretation', 'Text Interpretation'),
                    ('image_interpretation', 'Image Interpretation'),
                ],
                default='text_interpretation',
                help_text='Type of challenge',
            ),
        ),
        migrations.AddField(
            model_name='challenge',
            name='hidden_points',
            field=models.JSONField(
                default=list,
                help_text=(
                    'List of hidden visual points for image interpretation. '
                    'Each entry: {"label": "Broken clock", "accepted_meanings": ["lost time", "urgency", "missed opportunities"]}'
                ),
            ),
        ),
        migrations.AddField(
            model_name='challenge',
            name='prize_amount',
            field=models.DecimalField(
                max_digits=10,
                decimal_places=2,
                default=0,
                validators=[django.core.validators.MinValueValidator(0)],
                help_text='Cash prize in ZMW (0 = prestige-only)',
            ),
        ),
        migrations.AddField(
            model_name='challenge',
            name='entry_fee',
            field=models.DecimalField(
                max_digits=10,
                decimal_places=2,
                default=0,
                validators=[django.core.validators.MinValueValidator(0)],
                help_text='Entry fee in ZMW (0 = free)',
            ),
        ),
        # ── New model: ImageInterpretationSubmission ─────────────────────────
        migrations.CreateModel(
            name='ImageInterpretationSubmission',
            fields=[
                ('id', models.UUIDField(
                    primary_key=True, default=uuid.uuid4, editable=False, serialize=False,
                )),
                ('challenge', models.ForeignKey(
                    'challenges.Challenge',
                    on_delete=models.CASCADE,
                    related_name='image_submissions',
                )),
                ('user', models.ForeignKey(
                    'users.User',
                    on_delete=models.CASCADE,
                    related_name='image_interp_submissions',
                )),
                # Point discoveries: [{"label": "Broken clock", "interpretation": "Represents lost time"}]
                ('discovered_points', models.JSONField(
                    default=list,
                    help_text='Points the participant discovered with their interpretations',
                )),
                # Overall image message
                ('overall_message', models.TextField(
                    blank=True,
                    help_text='The overall message/story the participant sees in the image',
                )),
                # Time stats
                ('submission_time_seconds', models.IntegerField(
                    default=0,
                    validators=[django.core.validators.MinValueValidator(0)],
                    help_text='Seconds taken from image reveal to submission',
                )),
                # Scoring (0–100 per category)
                ('observation_score', models.IntegerField(
                    default=0,
                    validators=[
                        django.core.validators.MinValueValidator(0),
                        django.core.validators.MaxValueValidator(100),
                    ],
                    help_text='Score for observation accuracy (60% weight)',
                )),
                ('interpretation_score', models.IntegerField(
                    default=0,
                    validators=[
                        django.core.validators.MinValueValidator(0),
                        django.core.validators.MaxValueValidator(100),
                    ],
                    help_text='Score for interpretation quality (40% weight)',
                )),
                ('final_score', models.IntegerField(
                    default=0,
                    validators=[django.core.validators.MinValueValidator(0)],
                    help_text='Weighted final score mapped to points range',
                )),
                ('points_earned', models.IntegerField(
                    default=0,
                    validators=[django.core.validators.MinValueValidator(0)],
                )),
                # Status
                ('status', models.CharField(
                    max_length=20,
                    choices=[
                        ('submitted', 'Submitted'),
                        ('scoring', 'Being Scored'),
                        ('scored', 'Scored'),
                        ('rejected', 'Rejected'),
                    ],
                    default='submitted',
                )),
                # AI scoring feedback
                ('ai_feedback', models.TextField(
                    blank=True,
                    help_text='AI-generated scoring feedback shown to participant',
                )),
                # Timestamps
                ('submitted_at', models.DateTimeField(auto_now_add=True)),
                ('scored_at', models.DateTimeField(null=True, blank=True)),
                # Prize tracking
                ('prize_awarded', models.DecimalField(
                    max_digits=10,
                    decimal_places=2,
                    default=0,
                    help_text='Cash prize awarded (if any)',
                )),
            ],
            options={
                'db_table': 'image_interpretation_submissions',
                'ordering': ['-submitted_at'],
                'indexes': [
                    models.Index(fields=['challenge', 'user'], name='img_sub_challenge_user_idx'),
                    models.Index(fields=['status'], name='img_sub_status_idx'),
                    models.Index(fields=['final_score'], name='img_sub_score_idx'),
                ],
                'unique_together': {('challenge', 'user')},
            },
        ),
    ]
