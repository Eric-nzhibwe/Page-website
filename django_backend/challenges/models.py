"""
Challenge models for ARTX Platform
"""
from django.db import models
from django.utils import timezone
from django.core.validators import MinValueValidator, MaxValueValidator
from users.models import User
import uuid


class Challenge(models.Model):
    """Main Challenge model"""
    
    DIFFICULTY_CHOICES = [
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
        ('expert', 'Expert'),
    ]
    
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('active', 'Active'),
        ('paused', 'Paused'),
        ('ended', 'Ended'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=255)
    description = models.TextField()
    image_url = models.URLField(max_length=500)
    
    # Challenge settings
    difficulty = models.CharField(max_length=20, choices=DIFFICULTY_CHOICES, default='medium')
    time_limit = models.IntegerField(help_text="Time limit in minutes", validators=[MinValueValidator(1)])
    
    # Word count requirements
    min_word_count = models.IntegerField(default=50, validators=[MinValueValidator(1)])
    max_word_count = models.IntegerField(default=500, validators=[MinValueValidator(1)])
    
    # Submission rules
    submission_rules = models.JSONField(default=list, help_text="List of submission rules")
    
    # Scoring criteria (percentages that sum to 100)
    creativity_weight = models.IntegerField(default=40, validators=[MinValueValidator(0), MaxValueValidator(100)])
    relevance_weight = models.IntegerField(default=35, validators=[MinValueValidator(0), MaxValueValidator(100)])
    detail_weight = models.IntegerField(default=25, validators=[MinValueValidator(0), MaxValueValidator(100)])
    
    # Points range
    min_points = models.IntegerField(default=10, validators=[MinValueValidator(1)])
    max_points = models.IntegerField(default=50, validators=[MinValueValidator(1)])
    
    # Status and timing
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    
    # Metadata
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='created_challenges')
    is_featured = models.BooleanField(default=False)
    view_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    submission_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    class Meta:
        db_table = 'challenges'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'ends_at']),
            models.Index(fields=['difficulty']),
            models.Index(fields=['created_at']),
        ]
    
    def __str__(self):
        return f"{self.title} ({self.difficulty})"
    
    @property
    def is_active(self):
        """Check if challenge is currently active"""
        now = timezone.now()
        return self.status == 'active' and self.starts_at <= now <= self.ends_at
    
    @property
    def time_remaining(self):
        """Get time remaining in seconds"""
        now = timezone.now()
        if now > self.ends_at:
            return 0
        return int((self.ends_at - now).total_seconds())
    
    @property
    def has_started(self):
        """Check if challenge has started"""
        return timezone.now() >= self.starts_at
    
    @property
    def has_ended(self):
        """Check if challenge has ended"""
        return timezone.now() > self.ends_at
    
    def validate_scoring_weights(self):
        """Validate that scoring weights sum to 100"""
        total = self.creativity_weight + self.relevance_weight + self.detail_weight
        if total != 100:
            raise ValueError(f"Scoring weights must sum to 100, got {total}")
    
    def save(self, *args, **kwargs):
        self.validate_scoring_weights()
        super().save(*args, **kwargs)


class ChallengeSubmission(models.Model):
    """User submissions to challenges"""
    
    STATUS_CHOICES = [
        ('submitted', 'Submitted'),
        ('scored', 'Scored'),
        ('rejected', 'Rejected'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challenge = models.ForeignKey(Challenge, on_delete=models.CASCADE, related_name='submissions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='challenge_submissions')
    
    # Submission content
    interpretation = models.TextField()
    word_count = models.IntegerField(validators=[MinValueValidator(1)])
    
    # Scoring
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='submitted')
    creativity_score = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(100)])
    relevance_score = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(100)])
    detail_score = models.IntegerField(default=0, validators=[MinValueValidator(0), MaxValueValidator(100)])
    final_score = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Timestamps
    submitted_at = models.DateTimeField(auto_now_add=True)
    scored_at = models.DateTimeField(null=True, blank=True)
    
    # Metadata
    submission_time_seconds = models.IntegerField(help_text="Time taken to submit in seconds")
    
    class Meta:
        db_table = 'challenge_submissions'
        ordering = ['-submitted_at']
        unique_together = ['challenge', 'user']
        indexes = [
            models.Index(fields=['challenge', 'user']),
            models.Index(fields=['status']),
            models.Index(fields=['submitted_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.challenge.title}"
    
    def calculate_score(self):
        """Calculate final score based on weighted criteria"""
        weighted_score = (
            (self.creativity_score * self.challenge.creativity_weight / 100) +
            (self.relevance_score * self.challenge.relevance_weight / 100) +
            (self.detail_score * self.challenge.detail_weight / 100)
        )
        
        # Scale to points range
        points_range = self.challenge.max_points - self.challenge.min_points
        self.final_score = int(self.challenge.min_points + (weighted_score / 100) * points_range)
        
        return self.final_score
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        
        if self.status == 'scored' and not self.scored_at:
            self.scored_at = timezone.now()
            self.calculate_score()
        
        super().save(*args, **kwargs)
        
        # Update challenge submission count
        if is_new:
            self.challenge.submission_count += 1
            self.challenge.save(update_fields=['submission_count'])
        
        # Award prestige to user if scored
        if self.status == 'scored' and is_new:
            self.user.add_prestige(self.final_score, f"{self.challenge.difficulty} challenge: {self.challenge.title}")


class ChallengeLeaderboard(models.Model):
    """Real-time leaderboard for challenges"""
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challenge = models.OneToOneField(Challenge, on_delete=models.CASCADE, related_name='leaderboard')
    
    # Top performers (cached for performance)
    top_submissions = models.JSONField(default=list, help_text="Cached top 10 submissions")
    
    # Stats
    total_participants = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    average_score = models.FloatField(default=0.0, validators=[MinValueValidator(0)])
    highest_score = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'challenge_leaderboards'
    
    def __str__(self):
        return f"Leaderboard - {self.challenge.title}"
    
    def update_leaderboard(self):
        """Update leaderboard with top submissions"""
        top_submissions = self.challenge.submissions.filter(
            status='scored'
        ).select_related('user').order_by('-final_score')[:10]
        
        self.top_submissions = [
            {
                'rank': idx + 1,
                'user_id': str(submission.user.id),
                'username': submission.user.username,
                'score': submission.final_score,
                'word_count': submission.word_count,
                'submitted_at': submission.submitted_at.isoformat(),
            }
            for idx, submission in enumerate(top_submissions)
        ]
        
        # Update stats
        all_submissions = self.challenge.submissions.filter(status='scored')
        self.total_participants = self.challenge.submissions.values('user').distinct().count()
        
        if all_submissions.exists():
            scores = list(all_submissions.values_list('final_score', flat=True))
            self.average_score = sum(scores) / len(scores)
            self.highest_score = max(scores)
        
        self.save()


class ChallengeActivity(models.Model):
    """Real-time activity feed for challenges"""
    
    ACTIVITY_TYPES = [
        ('submission', 'New Submission'),
        ('score_update', 'Score Updated'),
        ('milestone', 'Milestone Reached'),
        ('leaderboard_change', 'Leaderboard Change'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    challenge = models.ForeignKey(Challenge, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='challenge_activities')
    
    activity_type = models.CharField(max_length=50, choices=ACTIVITY_TYPES)
    description = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'challenge_activities'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['challenge', 'created_at']),
            models.Index(fields=['user', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.activity_type}"
