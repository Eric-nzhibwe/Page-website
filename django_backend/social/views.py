"""
Views for social features - Posts, Comments, Shares, and Follows
"""
import uuid
from django.conf import settings as django_settings
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.authentication import TokenAuthentication, SessionAuthentication
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


def _use_fs_social():
    return django_settings.FIRESTORE_COLLECTIONS.get('social', False)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class PostViewSet(viewsets.ModelViewSet):
    """ViewSet for Posts with real-time updates"""

    serializer_class = PostSerializer
    permission_classes = [IsAuthenticated]
    authentication_classes = [TokenAuthentication, SessionAuthentication]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        user = self.request.user
        followed_users = user.following.values_list('following', flat=True)
        return Post.objects.filter(
            Q(author=user) | Q(author__in=followed_users)
        ).select_related('author').prefetch_related('comments', 'reactions', 'shares')

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    # ── create ────────────────────────────────────────────────────────────────

    def perform_create(self, serializer):
        if _use_fs_social():
            return  # handled in create() override below
        post = serializer.save(author=self.request.user)
        self._broadcast_new_post(post)

    def create(self, request, *args, **kwargs):
        if _use_fs_social():
            return self._create_firestore(request)
        return super().create(request, *args, **kwargs)

    def _create_firestore(self, request):
        from .firestore_social_service import create_post
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        import os

        data      = request.data
        media_url = None

        # Handle file upload if present
        media_file = request.FILES.get('media')
        if media_file:
            ext       = os.path.splitext(media_file.name)[1].lower()
            safe_name = f"posts/{request.user.id}_{uuid.uuid4().hex}{ext}"
            path      = default_storage.save(safe_name, ContentFile(media_file.read()))
            media_url = request.build_absolute_uri(default_storage.url(path))

        post = create_post(request.user, dict(data), media_url=media_url)
        if not post:
            return Response({'error': 'Failed to create post.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        self._broadcast_new_post_dict(post)
        return Response(post, status=status.HTTP_201_CREATED)

    # ── destroy ───────────────────────────────────────────────────────────────

    def destroy(self, request, *args, **kwargs):
        if _use_fs_social():
            from .firestore_social_service import delete_post
            ok = delete_post(kwargs.get('pk'), request.user.id)
            if not ok:
                return Response({'error': 'Not found or permission denied.'},
                                status=status.HTTP_404_NOT_FOUND)
            return Response(status=status.HTTP_204_NO_CONTENT)
        return super().destroy(request, *args, **kwargs)

    # ── retrieve ──────────────────────────────────────────────────────────────

    def retrieve(self, request, *args, **kwargs):
        if _use_fs_social():
            from .firestore_social_service import get_post
            post = get_post(kwargs.get('pk'), requesting_user=request.user)
            if post is None:
                return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(post)
        return super().retrieve(request, *args, **kwargs)

    # ── list (feed) ───────────────────────────────────────────────────────────

    def list(self, request, *args, **kwargs):
        if _use_fs_social():
            from .firestore_social_service import get_feed
            followed = list(request.user.following.values_list('following', flat=True))
            posts    = get_feed(followed, request.user.id)
            return Response({'results': posts, 'count': len(posts)})
        return super().list(request, *args, **kwargs)

    # ── reactions ─────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        """Add or update reaction to post."""
        reaction_type = request.data.get('reaction_type', 'fire')

        if _use_fs_social():
            from .firestore_social_service import react_to_post
            result = react_to_post(pk, request.user, reaction_type)
            code   = (status.HTTP_201_CREATED if result.get('created')
                      else status.HTTP_200_OK)
            return Response(result, status=code)

        post     = self.get_object()
        reaction, created = PostReaction.objects.update_or_create(
            post=post, user=request.user,
            defaults={'reaction_type': reaction_type}
        )
        return Response(PostReactionSerializer(reaction).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def unreact(self, request, pk=None):
        """Remove reaction from post."""
        if _use_fs_social():
            from .firestore_social_service import unreact_to_post
            removed = unreact_to_post(pk, request.user)
            if removed:
                return Response({'status': 'reaction removed'})
            return Response({'error': 'No reaction found'},
                            status=status.HTTP_404_NOT_FOUND)

        post     = self.get_object()
        reaction = post.reactions.filter(user=request.user).first()
        if reaction:
            reaction.delete()
            return Response({'status': 'reaction removed'})
        return Response({'error': 'No reaction found'}, status=status.HTTP_404_NOT_FOUND)

    # ── shares (always PostgreSQL — just tracking, not content) ──────────────

    @action(detail=True, methods=['post'])
    def share(self, request, pk=None):
        post     = self.get_object()
        platform = request.data.get('platform')
        if not platform:
            return Response({'error': 'Platform is required'},
                            status=status.HTTP_400_BAD_REQUEST)
        share, created = PostShare.objects.get_or_create(
            post=post, user=request.user, platform=platform
        )
        return Response(PostShareSerializer(share).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['get'])
    def share_urls(self, request, pk=None):
        post       = self.get_object()
        share_text = f"Check out this post on ARTX: {post.content[:100]}..."
        post_url   = f"{request.build_absolute_uri('/').rstrip('/')}/posts/{post.id}"
        return Response({
            'facebook': f"https://www.facebook.com/sharer/sharer.php?u={post_url}",
            'whatsapp': f"https://wa.me/?text={share_text}%20{post_url}",
            'x':        f"https://twitter.com/intent/tweet?text={share_text}&url={post_url}",
            'copy_link': post_url,
        })

    # ── broadcast helpers ─────────────────────────────────────────────────────

    def _broadcast_new_post(self, post):
        """Broadcast a Django model post instance to the feed channel."""
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            import json
            from django.core.serializers.json import DjangoJSONEncoder
            req       = type('Req', (), {'user': self.request.user})()
            post_data = PostSerializer(post, context={'request': req}).data
            get_channel_layer() and async_to_sync(
                get_channel_layer().group_send
            )('artx_feed', {
                'type': 'feed_new_post',
                'post': json.loads(json.dumps(dict(post_data), cls=DjangoJSONEncoder)),
            })
        except Exception:
            pass

    def _broadcast_new_post_dict(self, post_dict):
        """Broadcast a plain dict post to the feed channel."""
        try:
            from channels.layers import get_channel_layer
            from asgiref.sync import async_to_sync
            import json
            from django.core.serializers.json import DjangoJSONEncoder
            get_channel_layer() and async_to_sync(
                get_channel_layer().group_send
            )('artx_feed', {
                'type': 'feed_new_post',
                'post': json.loads(json.dumps(post_dict, cls=DjangoJSONEncoder)),
            })
        except Exception:
            pass


class CommentViewSet(viewsets.ModelViewSet):
    """ViewSet for Comments with real-time updates"""

    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated]
    authentication_classes = [TokenAuthentication, SessionAuthentication]

    def get_queryset(self):
        post_id = self.request.query_params.get('post_id')
        qs      = Comment.objects.select_related('author').prefetch_related(
            'reactions', 'replies__author', 'replies__reactions'
        )
        if post_id:
            try:
                uuid.UUID(str(post_id))
            except (ValueError, AttributeError):
                raise ValidationError({'post_id': f'"{post_id}" is not a valid post ID.'})
            return qs.filter(post_id=post_id, parent_comment__isnull=True)
        return qs.none()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    def list(self, request, *args, **kwargs):
        if _use_fs_social():
            from .firestore_social_service import get_comments
            post_id = request.query_params.get('post_id')
            if not post_id:
                return Response({'error': 'post_id is required'},
                                status=status.HTTP_400_BAD_REQUEST)
            return Response(get_comments(post_id))
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        if _use_fs_social():
            return  # handled in create() override
        post_id    = self.request.data.get('post_id')
        post       = get_object_or_404(Post, id=post_id)
        parent_id  = self.request.data.get('parent_comment_id')
        kwargs     = {'author': self.request.user, 'post': post}
        if parent_id:
            kwargs['parent_comment'] = get_object_or_404(Comment, id=parent_id)
        serializer.save(**kwargs)

    def create(self, request, *args, **kwargs):
        if _use_fs_social():
            from .firestore_social_service import add_comment
            post_id  = request.data.get('post_id')
            content  = request.data.get('content', '').strip()
            parent   = request.data.get('parent_comment_id')
            if not post_id or not content:
                return Response({'error': 'post_id and content are required.'},
                                status=status.HTTP_400_BAD_REQUEST)
            comment = add_comment(post_id, request.user, content, parent_id=parent)
            if not comment:
                return Response({'error': 'Failed to add comment.'},
                                status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response(comment, status=status.HTTP_201_CREATED)
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def react(self, request, pk=None):
        comment      = self.get_object()
        reaction_type = request.data.get('reaction_type', 'fire')
        reaction, created = CommentReaction.objects.update_or_create(
            comment=comment, user=request.user,
            defaults={'reaction_type': reaction_type}
        )
        return Response(CommentReactionSerializer(reaction).data,
                        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def reply(self, request, pk=None):
        content = request.data.get('content')
        if not content:
            return Response({'error': 'Content is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        if _use_fs_social():
            from .firestore_social_service import add_comment
            parent = self.get_object()  # still fetches from PG but only for validation
            comment = add_comment(str(parent.post_id), request.user,
                                  content, parent_id=str(pk))
            return Response(comment, status=status.HTTP_201_CREATED)

        parent_comment = self.get_object()
        reply = Comment.objects.create(
            post=parent_comment.post, author=request.user,
            content=content, parent_comment=parent_comment
        )
        return Response(CommentSerializer(reply, context={'request': request}).data,
                        status=status.HTTP_201_CREATED)


class FollowViewSet(viewsets.ViewSet):
    """
    ViewSet for Follow relationships with real-time updates
    """
    permission_classes = [IsAuthenticated]
    authentication_classes = [TokenAuthentication, SessionAuthentication]
    
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

    @action(detail=False, methods=['get'])
    def counts(self, request):
        """Return follower count, following count, and is_following for a user."""
        user_id = request.query_params.get('user_id', request.user.id)
        user = get_object_or_404(User, id=user_id)
        is_following = Follow.objects.filter(
            follower=request.user,
            following=user
        ).exists()
        return Response({
            'user_id':         user.id,
            'followers_count': Follow.objects.filter(following=user).count(),
            'following_count': Follow.objects.filter(follower=user).count(),
            'is_following':    is_following,
        })


class StoryViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Stories with real-time viewer tracking
    """
    serializer_class = StorySerializer
    permission_classes = [IsAuthenticated]
    authentication_classes = [TokenAuthentication, SessionAuthentication]
    pagination_class = StandardResultsSetPagination

    def get_parsers(self):
        """Accept both JSON and multipart (file upload)."""
        from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
        return [MultiPartParser(), FormParser(), JSONParser()]

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
