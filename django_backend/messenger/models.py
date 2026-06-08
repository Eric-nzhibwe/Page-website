from django.db import models
from django.conf import settings
import os


def message_media_path(instance, filename):
    """Generate upload path for message media"""
    # Format: messenger/user_id/conversation_id/filename
    return f'messenger/{instance.sender.id}/{instance.conversation.id}/{filename}'


class Conversation(models.Model):
    """Chat conversation between users"""
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-updated_at']
    
    def __str__(self):
        return f"Conversation {self.id}"
    
    def get_last_message(self):
        return self.messages.order_by('-timestamp').first()
    
    def get_other_participant(self, user):
        """Get the other participant in a 1-on-1 conversation"""
        return self.participants.exclude(id=user.id).first()


class Message(models.Model):
    """Individual message in a conversation"""
    MESSAGE_TYPES = (
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('audio', 'Audio'),
        ('file', 'File'),
    )
    
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    text = models.TextField(blank=True, null=True)
    
    # Media fields
    media_file = models.FileField(upload_to=message_media_path, blank=True, null=True)
    media_thumbnail = models.ImageField(upload_to=message_media_path, blank=True, null=True)
    media_duration = models.IntegerField(blank=True, null=True, help_text="Duration in seconds for audio/video")
    
    timestamp = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)
    
    class Meta:
        ordering = ['timestamp']
    
    def __str__(self):
        if self.message_type == 'text':
            return f"{self.sender.username}: {self.text[:50]}"
        return f"{self.sender.username}: [{self.message_type}]"
    
    def get_media_url(self):
        """Get full URL for media file"""
        if self.media_file:
            return self.media_file.url
        return None
    
    def get_thumbnail_url(self):
        """Get full URL for thumbnail"""
        if self.media_thumbnail:
            return self.media_thumbnail.url
        return None
