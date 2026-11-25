"""
Chatbot models — PAGE Platform
"""
from django.db import models
from django.conf import settings


class ChatSession(models.Model):
    """One continuous chat thread per user. Title is auto-set from first message."""
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE,
                                   related_name='chat_sessions')
    title      = models.CharField(max_length=200, default='New chat')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table  = 'chat_sessions'
        ordering  = ['-updated_at']

    def __str__(self):
        return f'{self.user.username} — {self.title}'


class ChatMessage(models.Model):
    ROLE_USER      = 'user'
    ROLE_ASSISTANT = 'assistant'
    ROLES = [(ROLE_USER, 'User'), (ROLE_ASSISTANT, 'Assistant')]

    session    = models.ForeignKey(ChatSession, on_delete=models.CASCADE,
                                   related_name='messages')
    role       = models.CharField(max_length=12, choices=ROLES)
    content    = models.TextField()
    # Store any extra info (model used, latency, media type, etc.)
    meta       = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'chat_messages'
        ordering = ['created_at']

    def __str__(self):
        return f'[{self.role}] {self.content[:60]}'
