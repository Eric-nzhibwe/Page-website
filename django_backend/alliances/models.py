"""
Alliance models for ARTX Platform
"""
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone


class Alliance(models.Model):
    """Alliance/Guild model"""
    
    # Basic info
    name = models.CharField(max_length=100, unique=True)
    tag = models.CharField(max_length=10, unique=True)  # Short alliance tag like [ARTX]
    description = models.TextField(max_length=500, blank=True)
    logo = models.ImageField(upload_to='alliance_logos/', blank=True, null=True)
    
    # Leadership
    leader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='led_alliances')
    officers = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='officer_alliances', blank=True)
    
    # Settings
    is_public = models.BooleanField(default=True)
    requires_approval = models.BooleanField(default=False)
    min_tier = models.CharField(max_length=50, default='Bronze')
    max_members = models.IntegerField(default=50)
    
    # Stats
    total_prestige = models.IntegerField(default=0)
    tournament_wins = models.IntegerField(default=0)
    level = models.IntegerField(default=1)
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'alliances'
        ordering = ['-total_prestige', '-created_at']
    
    def __str__(self):
        return f"[{self.tag}] {self.name}"
    
    @property
    def member_count(self):
        return self.members.filter(status='active').count()
    
    @property
    def is_full(self):
        return self.member_count >= self.max_members
    
    def calculate_level(self):
        """Calculate alliance level based on total prestige"""
        new_level = (self.total_prestige // 1000) + 1
        if new_level > self.level:
            self.level = new_level
            self.save()
    
    def add_member(self, user):
        """Add a new member to the alliance"""
        if not self.is_full:
            membership, created = AllianceMembership.objects.get_or_create(
                alliance=self,
                user=user,
                defaults={'status': 'active', 'joined_at': timezone.now()}
            )
            
            if created:
                # Update alliance stats
                self.total_prestige += user.prestige_points
                self.calculate_level()
                
                # Create activity
                from users.models import UserActivity
                UserActivity.objects.create(
                    user=user,
                    activity_type='alliance_join',
                    description=f"Joined alliance: [{self.tag}] {self.name}",
                    metadata={'alliance_id': self.id}
                )
                
                # Send alliance join email
                from notifications.tasks import send_alliance_join_email
                send_alliance_join_email(user.id, self.id)
                
                return membership
        return None


class AllianceMembership(models.Model):
    """Alliance membership"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('banned', 'Banned'),
    ]
    
    ROLE_CHOICES = [
        ('member', 'Member'),
        ('officer', 'Officer'),
        ('leader', 'Leader'),
    ]
    
    alliance = models.ForeignKey(Alliance, on_delete=models.CASCADE, related_name='members')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='alliance_memberships')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='member')
    
    # Contribution tracking
    prestige_contributed = models.IntegerField(default=0)
    tournaments_participated = models.IntegerField(default=0)
    
    # Timestamps
    joined_at = models.DateTimeField(auto_now_add=True)
    last_active = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'alliance_memberships'
        unique_together = ['alliance', 'user']
        ordering = ['-prestige_contributed', '-joined_at']
    
    def __str__(self):
        return f"{self.user.username} in [{self.alliance.tag}] {self.alliance.name}"
    
    def promote_to_officer(self):
        """Promote member to officer"""
        if self.role == 'member':
            self.role = 'officer'
            self.save()
            self.alliance.officers.add(self.user)
    
    def demote_from_officer(self):
        """Demote officer to member"""
        if self.role == 'officer':
            self.role = 'member'
            self.save()
            self.alliance.officers.remove(self.user)


class AllianceInvitation(models.Model):
    """Alliance invitations"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('accepted', 'Accepted'),
        ('declined', 'Declined'),
        ('expired', 'Expired'),
    ]
    
    alliance = models.ForeignKey(Alliance, on_delete=models.CASCADE, related_name='invitations')
    invited_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='alliance_invitations')
    invited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='sent_alliance_invitations')
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    message = models.TextField(max_length=200, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    responded_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'alliance_invitations'
        unique_together = ['alliance', 'invited_user']
        ordering = ['-created_at']
    
    def __str__(self):
        return f"Invitation to {self.invited_user.username} for [{self.alliance.tag}]"
    
    @property
    def is_expired(self):
        return timezone.now() > self.expires_at
    
    def accept(self):
        """Accept the invitation"""
        if self.status == 'pending' and not self.is_expired:
            self.status = 'accepted'
            self.responded_at = timezone.now()
            self.save()
            
            # Add user to alliance
            self.alliance.add_member(self.invited_user)
            return True
        return False
    
    def decline(self):
        """Decline the invitation"""
        if self.status == 'pending':
            self.status = 'declined'
            self.responded_at = timezone.now()
            self.save()
            return True
        return False


class AllianceEvent(models.Model):
    """Alliance events and activities"""
    
    EVENT_TYPES = [
        ('member_joined', 'Member Joined'),
        ('member_left', 'Member Left'),
        ('member_promoted', 'Member Promoted'),
        ('member_demoted', 'Member Demoted'),
        ('tournament_win', 'Tournament Win'),
        ('level_up', 'Alliance Level Up'),
        ('challenge_completed', 'Challenge Completed'),
    ]
    
    alliance = models.ForeignKey(Alliance, on_delete=models.CASCADE, related_name='events')
    event_type = models.CharField(max_length=50, choices=EVENT_TYPES)
    description = models.CharField(max_length=255)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'alliance_events'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"[{self.alliance.tag}] {self.description}"