"""
Views for social features - Posts, Comments, Shares, and Follows
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.pagination import PageNumberPagination
from django.shortcuts import get_object_or_404
from django.db.models import Q
from .models import Post, Comment, PostReaction, CommentReaction, PostShare, Follow, Story, StoryView
from .serializers import (
    PostSerializer, CommentSerializer, PostReactionSerializer,
    CommentReactionSerializer, PostShareSerializer, FollowSerializer,
    FollowListSerializer, StorySerializer, StoryViewSerializer
)
from users.models import User


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class PostViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Posts with real-time updates
    """
    serializer_class = PostSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        """Get posts from followed users and own posts"""
        user = self.request.user
        followed_users = user.following.values_list('following', flat=True)
        return Post.objects.filter(
            Q(author=user) | Q(author__in=followed_users)
        ).select_related('author').prefetch_related('comments', 'reactions', 'shares')
    
    def perform_create(self, serializer):
        """Create post with current user as author and broadcast to feed group."""
        post = serializer.save(author=self.request.user)
        # Broadcast new post to all connected feed clients
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            from .serializers import PostSerializer as PS
            import json
            from django.core.serializers.json import DjangoJSONEncoder
            req = type('Req', (), {'user': self.request.user})()
            post_data = PS(post, context={'request': req}).data
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                'artx_feed',
                {
                    'type': 'feed_new_post',
                    'post': json.loads(json.dumps(dict(post_data), cls=DjangoJSONEncoder))
                }
            )
        except Exception:
            pass  # Channel layer unavailable — still return success

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx
    
    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        """Add or update reaction to post"""
        post = self.get_object()
        reaction_type = request.data.get('reaction_type', 'fire')
        
        reaction, created = PostReaction.objects.update_or_create(
            post=post,
            user=request.user,
            defaults={'reaction_type': reaction_type}
        )
        
        serializer = PostReactionSerializer(reaction)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    
    @action(detail=True, methods=['post'])
    def unreact(self, request, pk=None):
        """Remove reaction from post"""
        post = self.get_object()
        reaction = post.reactions.filter(user=request.user).first()
        
        if reaction:
            reaction.delete()
            return Response({'status': 'reaction removed'}, status=status.HTTP_200_OK)
        
        return Response({'error': 'No reaction found'}, status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        """Share post to social media"""
        post = self.get_object()
        platform = request.data.get('platform')
        
        if not platform:
            return Response({'error': 'Platform is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        share, created = PostShare.objects.get_or_create(
            post=post,
            user=request.user,
            platform=platform
        )
        
        serializer = PostShareSerializer(share)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    
    @action(detail=True, methods=['get'])
    def share_urls(self, request, pk=None):
        """Get share URLs for different platforms"""
        post = self.get_object()
        
        # Build share message
        share_text = f"Check out this post on ARTX: {post.content[:100]}..."
        post_url = f"{request.build_absolute_uri('/').rstrip('/')}/posts/{post.id}"
        
        share_urls = {
            'facebook': f"https://www.facebook.com/sharer/sharer.php?u={post_url}",
            'whatsapp': f"https://wa.me/?text={share_text}%20{post_url}",
            'x': f"https://twitter.com/intent/tweet?text={share_text}&url={post_url}",
            'copy_link': post_url
        }
        
        return Response(share_urls)


class CommentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Comments with real-time updates
    """
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        """Get top-level comments for a specific post."""
        post_id = self.request.query_params.get('post_id')
        qs = Comment.objects.select_related('author').prefetch_related(
            'reactions', 'replies__author', 'replies__reactions'
        )
        if post_id:
            return qs.filter(post_id=post_id, parent_comment__isnull=True)
        return qs.none()  # Don't list all comments without a post_id

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def perform_create(self, serializer):
        """Create comment with current user as author."""
        post_id = self.request.data.get('post_id')
        post = get_object_or_404(Post, id=post_id)
        parent_id = self.request.data.get('parent_comment_id')
        kwargs = {'author': self.request.user, 'post': post}
        if parent_id:
            kwargs['parent_comment'] = get_object_or_404(Comment, id=parent_id)
        serializer.save(**kwargs)
    
    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        """Add or update reaction to comment"""
        comment = self.get_object()
        reaction_type = request.data.get('reaction_type', 'fire')
        
        reaction, created = CommentReaction.objects.update_or_create(
            comment=comment,
            user=request.user,
            defaults={'reaction_type': reaction_type}
        )
        
        serializer = CommentReactionSerializer(reaction)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    
    @action(detail=True, methods=['post'])
    def reply(self, request, pk=None):
        """Reply to a comment"""
        parent_comment = self.get_object()
        content = request.data.get('content')
        
        if not content:
            return Response({'error': 'Content is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        reply = Comment.objects.create(
            post=parent_comment.post,
            author=request.user,
            content=content,
            parent_comment=parent_comment
        )
        
        serializer = CommentSerializer(reply, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class FollowViewSet(viewsets.ViewSet):
    """
    ViewSet for Follow relationships with real-time updates
    """
    permission_classes = [IsAuthenticated]
    
    @action(detail=False, methods=['post'])
    def follow(self, request):
        """Follow a user"""
        user_id = request.data.get('user_id')
        
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        user_to_follow = get_object_or_404(User, id=user_id)
        
        if request.user == user_to_follow:
            return Response({'error': 'Cannot follow yourself'}, status=status.HTTP_400_BAD_REQUEST)
        
        follow, created = Follow.objects.get_or_create(
            follower=request.user,
            following=user_to_follow
        )

        if created:
            from notifications.views import create_notification
            create_notification(
                recipient=user_to_follow,
                actor=request.user,
                notif_type='follow',
                title=f'{request.user.username} started following you',
                message='',
                link=f'/pages/user.html?id={request.user.id}',
            )

        serializer = FollowSerializer(follow)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    
    @action(detail=False, methods=['post'])
    def unfollow(self, request):
        """Unfollow a user"""
        user_id = request.data.get('user_id')
        
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        user_to_unfollow = get_object_or_404(User, id=user_id)
        
        follow = Follow.objects.filter(
            follower=request.user,
            following=user_to_unfollow
        ).first()
        
        if follow:
            follow.delete()
            return Response({'status': 'unfollowed'}, status=status.HTTP_200_OK)
        
        return Response({'error': 'Not following this user'}, status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=False, methods=['get'])
    def followers(self, request):
        """Get user's followers"""
        user_id = request.query_params.get('user_id', request.user.id)
        user = get_object_or_404(User, id=user_id)
        
        follows = Follow.objects.filter(following=user)
        serializer = FollowListSerializer(follows, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def following(self, request):
        """Get users that current user is following"""
        user_id = request.query_params.get('user_id', request.user.id)
        user = get_object_or_404(User, id=user_id)
        
        follows = Follow.objects.filter(follower=user)
        serializer = FollowListSerializer(follows, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def is_following(self, request):
        """Check if current user is following a specific user"""
        user_id = request.query_params.get('user_id')
        
        if not user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        is_following = Follow.objects.filter(
            follower=request.user,
            following_id=user_id
        ).exists()
        
        return Response({'is_following': is_following})


class StoryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Stories with real-time viewer tracking
    """
    serializer_class = StorySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    
    def get_queryset(self):
        """Get non-expired stories from followed users"""
        from django.utils import timezone
        user = self.request.user
        followed_users = user.following.values_list('following', flat=True)
        
        return Story.objects.filter(
            Q(author=user) | Q(author__in=followed_users),
            expires_at__gt=timezone.now()
        ).select_related('author').prefetch_related('views')
    
    def perform_create(self, serializer):
        """Create story with current user as author"""
        serializer.save(author=self.request.user)
    
    @action(detail=True, methods=['post'])
    def view(self, request, pk=None):
        """Mark story as viewed by current user"""
        story = self.get_object()
        
        view, created = StoryView.objects.get_or_create(
            story=story,
            viewer=request.user
        )
        
        serializer = StoryViewSerializer(view)
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
    
    @action(detail=True, methods=['get'])
    def viewers(self, request, pk=None):
        """Get list of users who viewed this story"""
        story = self.get_object()
        
        # Only author can see viewers
        if story.author != request.user:
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        
        views = story.views.all().order_by('-viewed_at')
        serializer = StoryViewSerializer(views, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def feed(self, request):
        """Get stories feed for current user"""
        stories = self.get_queryset().order_by('-created_at')[:50]
        serializer = self.get_serializer(stories, many=True)
        return Response(serializer.data)
