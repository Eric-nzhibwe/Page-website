"""
Serializers for social features
"""
from rest_framework import serializers
from .models import Post, Comment, PostReaction, CommentReaction, PostShare, Follow
from users.models import User


class UserMinimalSerializer(serializers.ModelSerializer):
    """Minimal user info for nested serialization"""
    class Meta:
        model = User
        fields = ['id', 'username', 'display_name', 'profile_image']


class CommentReactionSerializer(serializers.ModelSerializer):
    user = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = CommentReaction
        fields = ['id', 'user', 'reaction_type', 'created_at']


class CommentSerializer(serializers.ModelSerializer):
    author = UserMinimalSerializer(read_only=True)
    reactions = CommentReactionSerializer(many=True, read_only=True)
    replies = serializers.SerializerMethodField()
    user_reaction = serializers.SerializerMethodField()
    
    class Meta:
        model = Comment
        fields = [
            'id', 'author', 'content', 'reaction_count', 'created_at',
            'updated_at', 'reactions', 'replies', 'user_reaction'
        ]
    
    def get_replies(self, obj):
        """Get nested replies"""
        replies = obj.replies.all()
        return CommentSerializer(replies, many=True).data
    
    def get_user_reaction(self, obj):
        """Check if current user has reacted"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            reaction = obj.reactions.filter(user=request.user).first()
            return reaction.reaction_type if reaction else None
        return None


class PostReactionSerializer(serializers.ModelSerializer):
    user = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = PostReaction
        fields = ['id', 'user', 'reaction_type', 'created_at']


class PostShareSerializer(serializers.ModelSerializer):
    class Meta:
        model = PostShare
        fields = ['id', 'platform', 'shared_at']


class PostSerializer(serializers.ModelSerializer):
    author = UserMinimalSerializer(read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    reactions = PostReactionSerializer(many=True, read_only=True)
    shares = PostShareSerializer(many=True, read_only=True)
    user_reaction = serializers.SerializerMethodField()
    user_has_shared = serializers.SerializerMethodField()
    
    class Meta:
        model = Post
        fields = [
            'id', 'author', 'content', 'post_type', 'media_url', 'media_type',
            'achievement_badge', 'challenge_id', 'reaction_count', 'comment_count',
            'share_count', 'created_at', 'updated_at', 'comments', 'reactions',
            'shares', 'user_reaction', 'user_has_shared'
        ]
    
    def get_user_reaction(self, obj):
        """Check if current user has reacted"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            reaction = obj.reactions.filter(user=request.user).first()
            return reaction.reaction_type if reaction else None
        return None
    
    def get_user_has_shared(self, obj):
        """Check if current user has shared"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.shares.filter(user=request.user).exists()
        return False


class FollowSerializer(serializers.ModelSerializer):
    follower = UserMinimalSerializer(read_only=True)
    following = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = Follow
        fields = ['id', 'follower', 'following', 'created_at']


class FollowListSerializer(serializers.ModelSerializer):
    """For listing followers/following"""
    user = serializers.SerializerMethodField()
    
    class Meta:
        model = Follow
        fields = ['id', 'user', 'created_at']
    
    def get_user(self, obj):
        """Return the other user (not the current user)"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            if obj.follower == request.user:
                return UserMinimalSerializer(obj.following).data
            else:
                return UserMinimalSerializer(obj.follower).data
        return None


class StoryViewSerializer(serializers.ModelSerializer):
    """Serializer for story views"""
    viewer = UserMinimalSerializer(read_only=True)
    
    class Meta:
        model = StoryView
        fields = ['id', 'viewer', 'viewed_at']


class StorySerializer(serializers.ModelSerializer):
    """Serializer for stories"""
    author = UserMinimalSerializer(read_only=True)
    views = StoryViewSerializer(many=True, read_only=True)
    user_has_viewed = serializers.SerializerMethodField()
    time_until_expiry = serializers.SerializerMethodField()
    
    class Meta:
        model = Story
        fields = [
            'id', 'author', 'content', 'media_url', 'media_type',
            'view_count', 'created_at', 'expires_at', 'views',
            'user_has_viewed', 'time_until_expiry'
        ]
    
    def get_user_has_viewed(self, obj):
        """Check if current user has viewed this story"""
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.views.filter(viewer=request.user).exists()
        return False
    
    def get_time_until_expiry(self, obj):
        """Get time remaining until story expires"""
        from django.utils import timezone
        now = timezone.now()
        if obj.expires_at > now:
            delta = obj.expires_at - now
            return delta.total_seconds()
        return 0
