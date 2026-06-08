"""
Tournament models for ARTX Platform
"""
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone
from decimal import Decimal


class Tournament(models.Model):
    """Tournament model"""
    
    STATUS_CHOICES = [
        ('upcoming', 'Upcoming'),
        ('active', 'Active'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    
    DIFFICULTY_CHOICES = [
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
        ('expert', 'Expert'),
    ]
    
    # Basic info
    title = models.CharField(max_length=200)
    description = models.TextField()
    difficulty = models.CharField(max_length=20, choices=DIFFICULTY_CHOICES, default='medium')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='upcoming')
    
    # Timing
    start_time = models.DateTimeField()
    end_time = models.DateTimeField()
    registration_deadline = models.DateTimeField()
    
    # Entry requirements
    entry_fee = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    min_tier = models.CharField(max_length=50, default='Bronze')
    max_participants = models.IntegerField(default=100)
    
    # Prize pool
    prize_pool = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    first_place_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=50.00)
    second_place_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=30.00)
    third_place_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=20.00)
    
    # Challenge data
    challenges = models.JSONField(default=list, blank=True)
    
    # Metadata
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='created_tournaments')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'tournaments'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'start_time']),
            models.Index(fields=['difficulty', 'status']),
        ]
    
    def __str__(self):
        return f"{self.title} ({self.status})"
    
    @property
    def is_registration_open(self):
        now = timezone.now()
        return (
            self.status == 'upcoming' and
            now < self.registration_deadline and
            self.participants.count() < self.max_participants
        )
    
    @property
    def participant_count(self):
        return self.participants.count()
    
    def calculate_prizes(self):
        """Calculate prize distribution"""
        first = (self.prize_pool * self.first_place_percentage) / 100
        second = (self.prize_pool * self.second_place_percentage) / 100
        third = (self.prize_pool * self.third_place_percentage) / 100
        
        return {
            'first_place': first,
            'second_place': second,
            'third_place': third
        }
    
    def start_tournament(self):
        """Start the tournament"""
        if self.status == 'upcoming' and timezone.now() >= self.start_time:
            self.status = 'active'
            self.save()
            
            # Create activity for all participants
            from users.models import UserActivity
            for participation in self.participants.all():
                UserActivity.objects.create(
                    user=participation.user,
                    activity_type='tournament_entry',
                    description=f"Tournament started: {self.title}",
                    metadata={'tournament_id': self.id}
                )
    
    def end_tournament(self):
        """End the tournament and calculate results"""
        if self.status == 'active' and timezone.now() >= self.end_time:
            self.status = 'completed'
            self.save()
            
            # Calculate leaderboard and distribute prizes
            self.calculate_leaderboard()


class TournamentParticipation(models.Model):
    """Tournament participation"""
    
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='tournament_participations')
    
    # Performance tracking
    score = models.IntegerField(default=0)
    rank = models.IntegerField(null=True, blank=True)
    challenges_completed = models.IntegerField(default=0)
    total_time = models.DurationField(null=True, blank=True)
    
    # Prize info
    prize_won = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    is_winner = models.BooleanField(default=False)
    
    # Timestamps
    registered_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'tournament_participations'
        unique_together = ['tournament', 'user']
        ordering = ['-score', 'total_time']
    
    def __str__(self):
        return f"{self.user.username} in {self.tournament.title}"
    
    def start_participation(self):
        """Mark participation as started"""
        if not self.started_at:
            self.started_at = timezone.now()
            self.save()
    
    def complete_participation(self):
        """Mark participation as completed"""
        if not self.completed_at:
            self.completed_at = timezone.now()
            if self.started_at:
                self.total_time = self.completed_at - self.started_at
            self.save()


class TournamentSubmission(models.Model):
    """Tournament challenge submissions"""
    
    participation = models.ForeignKey(TournamentParticipation, on_delete=models.CASCADE, related_name='submissions')
    challenge_index = models.IntegerField()
    answer = models.TextField()
    is_correct = models.BooleanField(default=False)
    points_earned = models.IntegerField(default=0)
    time_taken = models.DurationField(null=True, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'tournament_submissions'
        unique_together = ['participation', 'challenge_index']
        ordering = ['challenge_index', 'submitted_at']
    
    def __str__(self):
        return f"{self.participation.user.username}: Challenge {self.challenge_index}"
    
    def save(self, *args, **kwargs):
        """Update participation score when submission is saved"""
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        if is_new and self.is_correct:
            # Update participation score
            self.participation.score += self.points_earned
            self.participation.challenges_completed += 1
            self.participation.save()


class TournamentLeaderboard(models.Model):
    """Tournament leaderboard snapshot"""
    
    tournament = models.OneToOneField(Tournament, on_delete=models.CASCADE, related_name='leaderboard')
    rankings = models.JSONField(default=list)
    prize_distribution = models.JSONField(default=dict)
    generated_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'tournament_leaderboards'
    
    def __str__(self):
        return f"Leaderboard for {self.tournament.title}"