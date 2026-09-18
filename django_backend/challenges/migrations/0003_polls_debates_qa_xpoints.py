# Generated migration for Poll/Debate/QA challenges and XPoints
import uuid
import django.db.models.deletion
import django.core.validators
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('challenges', '0002_image_interpretation'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # XPoints Ledger
        migrations.CreateModel(
            name='XPointsLedger',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('balance', models.FloatField(default=10.0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='xpoints_ledger',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'xpoints_ledger'},
        ),

        # Poll Challenge
        migrations.CreateModel(
            name='PollChallenge',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True)),
                ('prize_amount', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('difficulty', models.CharField(default='easy', max_length=20)),
                ('duration_days', models.IntegerField(default=7)),
                ('options', models.JSONField(default=list)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='poll_challenges',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'poll_challenges', 'ordering': ['-created_at']},
        ),

        # Poll Vote
        migrations.CreateModel(
            name='PollVote',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('option_index', models.PositiveSmallIntegerField()),
                ('voted_at', models.DateTimeField(auto_now_add=True)),
                ('poll', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='votes',
                    to='challenges.pollchallenge',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='poll_votes',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'poll_votes'},
        ),
        migrations.AddConstraint(
            model_name='pollvote',
            constraint=models.UniqueConstraint(fields=['poll', 'user'], name='unique_poll_vote'),
        ),

        # Debate Challenge
        migrations.CreateModel(
            name='DebateChallenge',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True)),
                ('image_url', models.URLField(blank=True, max_length=500)),
                ('side_a', models.CharField(max_length=100)),
                ('side_b', models.CharField(max_length=100)),
                ('prize_amount', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('difficulty', models.CharField(default='medium', max_length=20)),
                ('duration_days', models.IntegerField(default=7)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='debate_challenges',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'debate_challenges', 'ordering': ['-created_at']},
        ),

        # Debate Participant
        migrations.CreateModel(
            name='DebateParticipant',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('side', models.CharField(choices=[('a', 'Side A'), ('b', 'Side B')], max_length=1)),
                ('joined_at', models.DateTimeField(auto_now_add=True)),
                ('debate', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='participants',
                    to='challenges.debatechallenge',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='debate_participations',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'debate_participants'},
        ),
        migrations.AddConstraint(
            model_name='debateparticipant',
            constraint=models.UniqueConstraint(fields=['debate', 'user'], name='unique_debate_participant'),
        ),

        # Debate Comment
        migrations.CreateModel(
            name='DebateComment',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('text', models.CharField(max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('debate', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='comments',
                    to='challenges.debatechallenge',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='debate_comments',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'debate_comments', 'ordering': ['-created_at']},
        ),

        # Q&A Challenge
        migrations.CreateModel(
            name='QAChallenge',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('title', models.CharField(max_length=255)),
                ('description', models.TextField(blank=True)),
                ('image_url', models.URLField(blank=True, max_length=500)),
                ('prize_amount', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('difficulty', models.CharField(default='easy', max_length=20)),
                ('duration_days', models.IntegerField(default=7)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='qa_challenges',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'qa_challenges', 'ordering': ['-created_at']},
        ),

        # Q&A Answer
        migrations.CreateModel(
            name='QAAnswer',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)),
                ('text', models.CharField(max_length=1000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('qa', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='answers',
                    to='challenges.qachallenge',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='qa_answers',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'db_table': 'qa_answers', 'ordering': ['-created_at']},
        ),
    ]
