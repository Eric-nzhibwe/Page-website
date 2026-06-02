"""
Notification models for ARTX Platform
"""
from django.db import models
from django.conf import settings


class InAppNotification(models.Model):
    """In-app notification shown in the bell dropdown."""

    TYPE_CHOICES = [
        ('follow',    'New Follower'),
        ('comment',   'New Comment'),
        ('reaction',  'New Reaction'),
        ('share',     'Post Shared'),
        ('mention',   'Mention'),
        ('system',    'System'),
    ]

    recipient   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                    related_name='inapp_notifications')
    actor       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='sent_notifications')
    notif_type  = models.CharField(max_length=20, choices=TYPE_CHOICES, default='system')
    title       = models.CharField(max_length=200)
    message     = models.TextField()
    link        = models.CharField(max_length=500, blank=True)   # e.g. /posts/<id>
    is_read     = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'inapp_notifications'
        ordering = ['-created_at']
        indexes  = [models.Index(fields=['recipient', 'is_read', 'created_at'])]

    def __str__(self):
        return f'{self.recipient.username} — {self.notif_type}: {self.title}'


class EmailTemplate(models.Model):
    """Email template model"""
    
    TEMPLATE_TYPES = [
        ('welcome', 'Welcome Email'),
        ('tier_upgrade', 'Tier Upgrade'),
        ('alliance_join', 'Alliance Join'),
        ('tournament_reminder', 'Tournament Reminder'),
        ('payment_confirmation', 'Payment Confirmation'),
        ('withdrawal_processed', 'Withdrawal Processed'),
    ]
    
    name = models.CharField(max_length=100, unique=True)
    template_type = models.CharField(max_length=50, choices=TEMPLATE_TYPES)
    subject = models.CharField(max_length=200)
    html_content = models.TextField()
    text_content = models.TextField(blank=True)
    
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'email_templates'
    
    def __str__(self):
        return f"{self.name} ({self.template_type})"


class NotificationLog(models.Model):
    """Log of sent notifications"""
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
        ('bounced', 'Bounced'),
    ]
    
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    template = models.ForeignKey(EmailTemplate, on_delete=models.CASCADE, null=True, blank=True)
    
    subject = models.CharField(max_length=200)
    recipient_email = models.EmailField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    
    # Provider info
    provider_message_id = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'notification_logs'
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.recipient_email}: {self.subject} ({self.status})"