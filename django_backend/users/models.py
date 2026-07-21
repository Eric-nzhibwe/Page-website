"""
User models for ARTX Platform
"""
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.core.validators import MinValueValidator
from django.utils import timezone
import secrets
import json

class User(AbstractUser):
    """Extended User model for ARTX Platform"""
    
    # Basic profile info
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=100, blank=True)
    profile_image = models.ImageField(upload_to='profiles/', blank=True, null=True)
    bio = models.TextField(max_length=500, blank=True)
    
    # Gaming stats
    prestige_points = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    level = models.IntegerField(default=1, validators=[MinValueValidator(1)])
    power_rank = models.CharField(max_length=50, default='Novice')
    access_tier = models.CharField(max_length=50, default='Bronze')
    
    # Streak and activity
    current_streak = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    last_login_date = models.DateField(auto_now=True)
    total_submissions = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    successful_submissions = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Financial
    total_earnings = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tournament_wins = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Extended profile
    phone = models.CharField(max_length=30, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    location = models.CharField(max_length=100, blank=True)
    website = models.URLField(max_length=255, blank=True)

    # User preferences (privacy, notifications, appearance) stored as JSON
    preferences = models.JSONField(default=dict, blank=True)

    # Verification and social
    is_verified = models.BooleanField(default=False)
    verification_level = models.IntegerField(default=0)  # 0=none, 1=email, 2=social, 3=identity
    social_connections = models.JSONField(default=dict, blank=True)

    # Security
    failed_login_attempts = models.IntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    password_changed_at = models.DateTimeField(null=True, blank=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    # Use email as username
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']
    
    class Meta:
        db_table = 'users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
    
    def __str__(self):
        return f"{self.username} ({self.email})"
    
    @property
    def success_rate(self):
        """Calculate success rate percentage"""
        if self.total_submissions == 0:
            return 0
        return round((self.successful_submissions / self.total_submissions) * 100, 1)
    
    def add_prestige(self, amount, source="Unknown"):
        """Add prestige points and update level/tier"""
        self.prestige_points += amount
        self.update_level()
        self.update_access_tier()
        self.save()
        
        # Create activity log
        UserActivity.objects.create(
            user=self,
            activity_type='prestige_gained',
            description=f"Gained {amount} prestige from {source}",
            points_change=amount
        )

    def spend_prestige(self, amount, reason="Reward redemption"):
        """Deduct prestige points for a reward purchase. Returns False if insufficient balance."""
        if self.prestige_points < amount:
            return False
        self.prestige_points -= amount
        self.update_access_tier()
        self.save(update_fields=['prestige_points', 'access_tier'])
        UserActivity.objects.create(
            user=self,
            activity_type='prestige_spent',
            description=f"Spent {amount} prestige on: {reason}",
            points_change=-amount,
        )
        return True
    
    def update_level(self):
        """Update user level based on prestige points"""
        new_level = (self.prestige_points // 100) + 1
        if new_level > self.level:
            old_level = self.level
            self.level = new_level
            
            # Create level up activity
            UserActivity.objects.create(
                user=self,
                activity_type='level_up',
                description=f"Level up! Reached level {new_level}",
                metadata={'old_level': old_level, 'new_level': new_level}
            )
    
    def update_access_tier(self):
        """Update access tier based on prestige points"""
        tiers = [
            (5000, 'Legendary'),
            (2500, 'Elite'),
            (1500, 'Diamond'),
            (1000, 'Platinum'),
            (500, 'Gold'),
            (200, 'Silver'),
            (0, 'Bronze'),
        ]
        
        old_tier = self.access_tier
        for min_prestige, tier_name in tiers:
            if self.prestige_points >= min_prestige:
                if self.access_tier != tier_name:
                    self.access_tier = tier_name
                    
                    # Create tier upgrade activity
                    UserActivity.objects.create(
                        user=self,
                        activity_type='tier_upgrade',
                        description=f"Tier upgrade! Now {tier_name}",
                        metadata={'old_tier': old_tier, 'new_tier': tier_name}
                    )
                    
                    # Send tier upgrade email (async if Celery is available)
                    try:
                        from notifications.tasks import send_tier_upgrade_email
                        send_tier_upgrade_email(self.id, old_tier, tier_name)
                    except Exception:
                        # Email sending failed, skip
                        pass
                break
    
    def update_power_rank(self):
        """Update power rank based on prestige points"""
        ranks = [
            (2000, 'Elite'),
            (1000, 'Master'),
            (600, 'Expert'),
            (300, 'Skilled'),
            (100, 'Apprentice'),
            (0, 'Novice'),
        ]
        
        for min_prestige, rank_name in ranks:
            if self.prestige_points >= min_prestige:
                if self.power_rank != rank_name:
                    self.power_rank = rank_name
                break
    
    def get_social_connections(self):
        """Get social connections as dict"""
        return self.social_connections or {}
    
    def add_social_connection(self, platform, username, verified=False, profile_image_url=None):
        """Add or update social media connection"""
        connections = self.get_social_connections()
        connections[platform] = {
            'connected': True,
            'username': username,
            'verified': verified,
            'profile_image_url': profile_image_url,
            'connected_at': timezone.now().isoformat()
        }
        self.social_connections = connections
        
        # Update verification level if social verification achieved
        if verified and self.verification_level < 2:
            self.verification_level = 2
            self.is_verified = True
        
        self.save()


class UserActivity(models.Model):
    """Track user activities and achievements"""
    
    ACTIVITY_TYPES = [
        ('prestige_gained', 'Prestige Gained'),
        ('level_up', 'Level Up'),
        ('tier_upgrade', 'Tier Upgrade'),
        ('tournament_entry', 'Tournament Entry'),
        ('tournament_win', 'Tournament Win'),
        ('alliance_join', 'Alliance Join'),
        ('alliance_create', 'Alliance Create'),
        ('payment_made', 'Payment Made'),
        ('withdrawal_request', 'Withdrawal Request'),
        ('submission_success', 'Successful Submission'),
        ('submission_failed', 'Failed Submission'),
    ]
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='activities')
    activity_type = models.CharField(max_length=50, choices=ACTIVITY_TYPES)
    description = models.CharField(max_length=255)
    points_change = models.IntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'user_activities'
        ordering = ['-created_at']
        verbose_name = 'User Activity'
        verbose_name_plural = 'User Activities'
    
    def __str__(self):
        return f"{self.user.username}: {self.description}"


class UserSubmission(models.Model):
    """Track user challenge submissions"""
    
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='submissions')
    challenge_id = models.CharField(max_length=100, blank=True)
    answer = models.TextField()
    is_correct = models.BooleanField(default=False)
    points_earned = models.IntegerField(default=0)
    difficulty = models.CharField(max_length=20, default='medium')
    submitted_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'user_submissions'
        ordering = ['-submitted_at']
    
    def __str__(self):
        return f"{self.user.username}: {self.points_earned} points"
    
    def save(self, *args, **kwargs):
        """Update user stats when submission is saved"""
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        if is_new:
            # Update user submission counts
            self.user.total_submissions += 1
            if self.is_correct:
                self.user.successful_submissions += 1
                self.user.add_prestige(self.points_earned, f"{self.difficulty} challenge")
            
            self.user.save()
            
            # Create activity
            activity_type = 'submission_success' if self.is_correct else 'submission_failed'
            UserActivity.objects.create(
                user=self.user,
                activity_type=activity_type,
                description=f"{'Correct' if self.is_correct else 'Incorrect'} answer: {self.points_earned} points",
                points_change=self.points_earned if self.is_correct else 0,
                metadata={
                    'difficulty': self.difficulty,
                    'challenge_id': self.challenge_id
                }
            )


class PasswordResetToken(models.Model):
    """Single-use token for password reset."""
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_reset_tokens')
    token      = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used       = models.BooleanField(default=False)

    class Meta:
        db_table = 'password_reset_tokens'

    def __str__(self):
        return f"PasswordReset for {self.user.email}"

    @classmethod
    def create_for_user(cls, user, expiry_hours=2):
        cls.objects.filter(user=user, used=False).update(used=True)
        token = secrets.token_urlsafe(48)
        return cls.objects.create(
            user=user,
            token=token,
            expires_at=timezone.now() + timezone.timedelta(hours=expiry_hours),
        )

    @property
    def is_valid(self):
        return not self.used and timezone.now() < self.expires_at


class LoginHistory(models.Model):
    """Immutable log of every login attempt."""
    STATUS_CHOICES = [
        ('success',    'Success'),
        ('failed',     'Failed — bad credentials'),
        ('locked',     'Failed — account locked'),
        ('unverified', 'Failed — email not verified'),
    ]

    user       = models.ForeignKey(
        User, on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='login_history',
    )
    identifier = models.CharField(max_length=255)
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=512, blank=True)
    location   = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = 'login_history'
        ordering = ['-created_at']
        indexes  = [
            models.Index(fields=['user', '-created_at']),
            models.Index(fields=['ip_address', '-created_at']),
        ]

    def __str__(self):
        return f"{self.identifier} — {self.status} @ {self.created_at:%Y-%m-%d %H:%M}"
