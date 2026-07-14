"""
Social models for ARTX Platform - Posts, Comments, and Shares
"""
from django.db import models
from django.utils import timezone
from django.core.validators import MinValueValidator
from users.models import User
import uuid


class Post(models.Model):
    """Social media posts"""
    
    POST_TYPE_CHOICES = [
        ('text', 'Text'),
        ('achievement', 'Achievement'),
        ('challenge', 'Challenge'),
        ('media', 'Media'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='posts')
    
    # Content
    content = models.TextField(max_length=5000)
    post_type = models.CharField(max_length=20, choices=POST_TYPE_CHOICES, default='text')
    
    # Media
    media_url = models.URLField(blank=True, null=True)
    media_type = models.CharField(max_length=20, choices=[('image', 'Image'), ('video', 'Video')], blank=True)
    
    # Metadata
    achievement_badge = models.JSONField(default=dict, blank=True)  # For achievement posts
    challenge_id = models.CharField(max_length=100, blank=True)  # For challenge posts
    
    # Engagement
    reaction_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    comment_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    share_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'social_posts'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['author', 'created_at']),
            models.Index(fields=['created_at']),
        ]
    
    def __str__(self):
        return f"{self.author.username} - {self.post_type}"


class Comment(models.Model):
    """Comments on posts"""
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comments')
    
    # Content
    content = models.TextField(max_length=1000)
    
    # Nested comments (replies)
    parent_comment = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='replies'
    )
    
    # Engagement
    reaction_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'social_comments'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['post', 'created_at']),
            models.Index(fields=['author', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.author.username} - Comment on {self.post.id}"
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Update post comment count
        if is_new:
            self.post.comment_count += 1
            self.post.save(update_fields=['comment_count'])


class PostReaction(models.Model):
    """Reactions to posts (likes, fire, etc.)"""
    
    REACTION_TYPES = [
        ('fire', '🔥'),
        ('like', '👍'),
        ('love', '❤️'),
        ('wow', '😮'),
        ('sad', '😢'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='post_reactions')
    
    reaction_type = models.CharField(max_length=20, choices=REACTION_TYPES, default='fire')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'social_post_reactions'
        unique_together = ['post', 'user']
        indexes = [
            models.Index(fields=['post', 'created_at']),
            models.Index(fields=['user', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.reaction_type} on {self.post.id}"
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Update post reaction count
        if is_new:
            self.post.reaction_count += 1
            self.post.save(update_fields=['reaction_count'])
    
    def delete(self, *args, **kwargs):
        self.post.reaction_count -= 1
        self.post.save(update_fields=['reaction_count'])
        super().delete(*args, **kwargs)


class CommentReaction(models.Model):
    """Reactions to comments"""
    
    REACTION_TYPES = [
        ('fire', '🔥'),
        ('like', '👍'),
        ('love', '❤️'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    comment = models.ForeignKey(Comment, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='comment_reactions')
    
    reaction_type = models.CharField(max_length=20, choices=REACTION_TYPES, default='fire')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'social_comment_reactions'
        unique_together = ['comment', 'user']
    
    def __str__(self):
        return f"{self.user.username} - {self.reaction_type} on comment"
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Update comment reaction count
        if is_new:
            self.comment.reaction_count += 1
            self.comment.save(update_fields=['reaction_count'])
    
    def delete(self, *args, **kwargs):
        self.comment.reaction_count -= 1
        self.comment.save(update_fields=['reaction_count'])
        super().delete(*args, **kwargs)


class PostShare(models.Model):
    """Track post shares to social media"""
    
    PLATFORM_CHOICES = [
        ('facebook', 'Facebook'),
        ('whatsapp', 'WhatsApp'),
        ('x', 'X (Twitter)'),
        ('copy_link', 'Copy Link'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='shares')
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='post_shares')
    
    platform = models.CharField(max_length=20, choices=PLATFORM_CHOICES)
    shared_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'social_post_shares'
        ordering = ['-shared_at']
        indexes = [
            models.Index(fields=['post', 'shared_at']),
            models.Index(fields=['user', 'shared_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - Shared to {self.platform}"
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Update post share count
        if is_new:
            self.post.share_count += 1
            self.post.save(update_fields=['share_count'])


class Follow(models.Model):
    """User follow relationships"""
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follower = models.ForeignKey(User, on_delete=models.CASCADE, related_name='following')
    following = models.ForeignKey(User, on_delete=models.CASCADE, related_name='followers')
    
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'social_follows'
        unique_together = ['follower', 'following']
        indexes = [
            models.Index(fields=['follower', 'created_at']),
            models.Index(fields=['following', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.follower.username} follows {self.following.username}"
    
    def save(self, *args, **kwargs):
        if self.follower == self.following:
            raise ValueError("Users cannot follow themselves")
        super().save(*args, **kwargs)


class Story(models.Model):
    """User stories (temporary posts)"""
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='stories')
    
    # Content
    content = models.TextField(max_length=500, blank=True)
    media_url = models.URLField(blank=True)          # external URL (optional)
    media_file = models.FileField(                   # uploaded file (preferred)
        upload_to='stories/',
        blank=True,
        null=True,
    )
    media_type = models.CharField(max_length=20, choices=[('image', 'Image'), ('video', 'Video')])
    
    # Metadata
    view_count = models.IntegerField(default=0, validators=[MinValueValidator(0)])
    
    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()  # Stories expire after 24 hours
    
    class Meta:
        db_table = 'social_stories'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['author', 'created_at']),
            models.Index(fields=['expires_at']),
        ]
    
    def __str__(self):
        return f"{self.author.username} - Story"
    
    def is_expired(self):
        """Check if story has expired"""
        return timezone.now() > self.expires_at
    
    def save(self, *args, **kwargs):
        if not self.expires_at:
            # Set expiry to 24 hours from now
            self.expires_at = timezone.now() + timezone.timedelta(hours=24)
        super().save(*args, **kwargs)


class StoryView(models.Model):
    """Track who viewed a story"""
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name='views')
    viewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='story_views')
    
    viewed_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'social_story_views'
        unique_together = ['story', 'viewer']
        ordering = ['-viewed_at']
        indexes = [
            models.Index(fields=['story', 'viewed_at']),
            models.Index(fields=['viewer', 'viewed_at']),
        ]
    
    def __str__(self):
        return f"{self.viewer.username} viewed {self.story.author.username}'s story"
    
    def save(self, *args, **kwargs):
        is_new = self.pk is None
        super().save(*args, **kwargs)
        
        # Update story view count
        if is_new:
            self.story.view_count += 1
            self.story.save(update_fields=['view_count'])
