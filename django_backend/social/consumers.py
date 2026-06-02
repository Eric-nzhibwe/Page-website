"""
WebSocket consumers for real-time social features.

Connections are authenticated via a `token` query-param:
  ws://host/ws/social/feed/?token=<DRF auth token>
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.serializers.json import DjangoJSONEncoder


# ─────────────────────────────────────────────────────────────────────────────
#  TOKEN AUTH HELPER
# ─────────────────────────────────────────────────────────────────────────────
@database_sync_to_async
def _get_user_from_token(token_key):
    """Return (user, error_str).  error_str is None on success."""
    if not token_key:
        return None, 'no_token'
    try:
        from rest_framework.authtoken.models import Token
        token = Token.objects.select_related('user').get(key=token_key)
        if not token.user.is_active:
            return None, 'inactive'
        return token.user, None
    except Token.DoesNotExist:
        return None, 'invalid_token'
    except Exception as e:
        return None, str(e)


def _token_from_scope(scope):
    """Extract token from ?token= query string."""
    qs = scope.get('query_string', b'').decode()
    for part in qs.split('&'):
        if part.startswith('token='):
            return part.split('=', 1)[1]
    return None


def _send(payload):
    """Serialize to JSON using Django encoder (handles UUID, Decimal, datetime)."""
    return json.dumps(payload, cls=DjangoJSONEncoder)


# ─────────────────────────────────────────────────────────────────────────────
#  FEED CONSUMER  — live post/story feed for all users
# ─────────────────────────────────────────────────────────────────────────────
class FeedConsumer(AsyncWebsocketConsumer):
    """
    Broadcast channel for the main social feed.
    Every connected authenticated client joins the 'feed' group.
    The server pushes new posts, reactions and live activity events here.
    """
    GROUP = 'artx_feed'

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.GROUP, self.channel_name)
        await self.accept()

        # Immediately send the latest 20 posts on connect
        posts = await self._get_feed_posts()
        await self.send(text_data=_send({
            'type': 'feed_snapshot',
            'posts': posts
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.GROUP, self.channel_name)

    async def receive(self, text_data):
        """Clients can send 'ping' to keep connection alive."""
        try:
            data = json.loads(text_data)
            if data.get('action') == 'ping':
                await self.send(text_data=_send({'type': 'pong'}))
        except (json.JSONDecodeError, KeyError):
            pass

    # ── group message handlers ────────────────────────────────────────────────
    async def feed_new_post(self, event):
        await self.send(text_data=_send({
            'type': 'new_post',
            'post': event['post']
        }))

    async def feed_post_update(self, event):
        await self.send(text_data=_send({
            'type': 'post_update',
            'post_id':       event['post_id'],
            'reaction_count': event.get('reaction_count'),
            'comment_count':  event.get('comment_count'),
            'share_count':    event.get('share_count'),
        }))

    async def feed_live_activity(self, event):
        await self.send(text_data=_send({
            'type':    'live_activity',
            'user':    event['user'],
            'action':  event['action'],
        }))

    async def feed_new_story(self, event):
        await self.send(text_data=_send({
            'type':  'new_story',
            'story': event['story']
        }))

    # ── DB helpers ────────────────────────────────────────────────────────────
    @database_sync_to_async
    def _get_feed_posts(self):
        from django.db.models import Q
        from .models import Post
        from .serializers import PostSerializer
        from django.http import HttpRequest

        qs = Post.objects.filter(
            Q(author=self.user) |
            Q(author__in=self.user.following.values_list('following', flat=True))
        ).select_related('author').prefetch_related(
            'reactions', 'shares'
        ).order_by('-created_at')[:20]

        # Build a minimal fake request so serializer can check user_reaction
        req = type('Req', (), {'user': self.user})()
        return PostSerializer(qs, many=True, context={'request': req}).data


# ─────────────────────────────────────────────────────────────────────────────
#  POST CONSUMER  — per-post room for comments / reactions / shares
# ─────────────────────────────────────────────────────────────────────────────
class PostConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.post_id        = self.scope['url_route']['kwargs']['post_id']
        self.post_group     = f'post_{self.post_id}'

        await self.channel_layer.group_add(self.post_group, self.channel_name)
        await self.accept()

        # Send existing comments on connect
        comments = await self._get_comments()
        await self.send(text_data=_send({
            'type':     'comments_snapshot',
            'comments': comments,
            'post_id':  self.post_id,
        }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.post_group, self.channel_name)

    async def receive(self, text_data):
        try:
            data   = json.loads(text_data)
            action = data.get('action')
        except json.JSONDecodeError:
            return

        if action == 'comment':
            await self._handle_comment(data)
        elif action == 'react':
            await self._handle_reaction(data)
        elif action == 'share':
            await self._handle_share(data)
        elif action == 'ping':
            await self.send(text_data=_send({'type': 'pong'}))

    # ── handlers ──────────────────────────────────────────────────────────────
    async def _handle_comment(self, data):
        content = (data.get('content') or '').strip()
        if not content:
            await self.send(text_data=_send({'type': 'error', 'message': 'Content required'}))
            return

        comment = await self._create_comment(content, data.get('parent_id'))

        # Broadcast to the post room
        await self.channel_layer.group_send(self.post_group, {
            'type':    'ws_comment_created',
            'comment': comment,
            'post_id': self.post_id,
        })

        # Also push count update to the global feed channel
        counts = await self._get_post_counts()
        await self.channel_layer.group_send(FeedConsumer.GROUP, {
            'type':          'feed_post_update',
            'post_id':       self.post_id,
            'comment_count': counts['comment_count'],
            'reaction_count': counts['reaction_count'],
            'share_count':   counts['share_count'],
        })

    async def _handle_reaction(self, data):
        reaction_type = data.get('reaction_type', 'fire')
        result = await self._toggle_reaction(reaction_type)

        await self.channel_layer.group_send(self.post_group, {
            'type':     'ws_reaction_updated',
            'reaction': result,
            'post_id':  self.post_id,
        })

        counts = await self._get_post_counts()
        await self.channel_layer.group_send(FeedConsumer.GROUP, {
            'type':           'feed_post_update',
            'post_id':        self.post_id,
            'reaction_count': counts['reaction_count'],
            'comment_count':  counts['comment_count'],
            'share_count':    counts['share_count'],
        })

    async def _handle_share(self, data):
        platform = data.get('platform')
        if not platform:
            await self.send(text_data=_send({'type': 'error', 'message': 'Platform required'}))
            return

        share = await self._create_share(platform)

        await self.channel_layer.group_send(self.post_group, {
            'type':    'ws_post_shared',
            'share':   share,
            'post_id': self.post_id,
        })

        counts = await self._get_post_counts()
        await self.channel_layer.group_send(FeedConsumer.GROUP, {
            'type':          'feed_post_update',
            'post_id':       self.post_id,
            'share_count':   counts['share_count'],
            'comment_count': counts['comment_count'],
            'reaction_count': counts['reaction_count'],
        })

    # ── group message handlers (broadcast → all members of group) ─────────────
    async def ws_comment_created(self, event):
        await self.send(text_data=_send({
            'type':    'comment_created',
            'comment': event['comment'],
            'post_id': event['post_id'],
        }))

    async def ws_reaction_updated(self, event):
        await self.send(text_data=_send({
            'type':     'reaction_updated',
            'reaction': event['reaction'],
            'post_id':  event['post_id'],
        }))

    async def ws_post_shared(self, event):
        await self.send(text_data=_send({
            'type':    'post_shared',
            'share':   event['share'],
            'post_id': event['post_id'],
        }))

    # ── DB helpers ────────────────────────────────────────────────────────────
    @database_sync_to_async
    def _get_comments(self):
        from .models import Comment
        from .serializers import CommentSerializer
        req = type('Req', (), {'user': self.user})()
        qs = Comment.objects.filter(
            post_id=self.post_id, parent_comment__isnull=True
        ).select_related('author').prefetch_related('reactions', 'replies__author', 'replies__reactions')
        return CommentSerializer(qs, many=True, context={'request': req}).data

    @database_sync_to_async
    def _create_comment(self, content, parent_id=None):
        from .models import Post, Comment
        from .serializers import CommentSerializer
        from notifications.views import create_notification
        post = Post.objects.get(id=self.post_id)
        kwargs = {'post': post, 'author': self.user, 'content': content}
        if parent_id:
            try:
                kwargs['parent_comment'] = Comment.objects.get(id=parent_id)
            except Comment.DoesNotExist:
                pass
        comment = Comment.objects.create(**kwargs)
        # Notify post author
        create_notification(
            recipient=post.author,
            actor=self.user,
            notif_type='comment',
            title=f'{self.user.username} commented on your post',
            message=content[:120],
            link=f'/posts/{self.post_id}',
        )
        req = type('Req', (), {'user': self.user})()
        return CommentSerializer(comment, context={'request': req}).data

    @database_sync_to_async
    def _toggle_reaction(self, reaction_type):
        from .models import Post, PostReaction
        from .serializers import PostReactionSerializer
        from notifications.views import create_notification
        post = Post.objects.get(id=self.post_id)
        existing = post.reactions.filter(user=self.user).first()
        if existing:
            existing.delete()
            return {'removed': True, 'user_id': self.user.id, 'post_id': str(post.id)}
        reaction = PostReaction.objects.create(post=post, user=self.user, reaction_type=reaction_type)
        create_notification(
            recipient=post.author,
            actor=self.user,
            notif_type='reaction',
            title=f'{self.user.username} reacted 🔥 to your post',
            message=post.content[:80],
            link=f'/posts/{self.post_id}',
        )
        return PostReactionSerializer(reaction).data

    @database_sync_to_async
    def _create_share(self, platform):
        from .models import Post, PostShare
        post = Post.objects.get(id=self.post_id)
        share, _ = PostShare.objects.get_or_create(post=post, user=self.user, platform=platform)
        return {'id': str(share.id), 'platform': share.platform, 'shared_at': share.shared_at.isoformat()}

    @database_sync_to_async
    def _get_post_counts(self):
        from .models import Post
        p = Post.objects.get(id=self.post_id)
        return {
            'reaction_count': p.reaction_count,
            'comment_count':  p.comment_count,
            'share_count':    p.share_count,
        }


# ─────────────────────────────────────────────────────────────────────────────
#  STORY CONSUMER
# ─────────────────────────────────────────────────────────────────────────────
class StoryConsumer(AsyncWebsocketConsumer):
    GROUP = 'artx_stories'

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        await self.channel_layer.group_add(self.GROUP, self.channel_name)
        await self.accept()

        # Send current stories on connect
        stories = await self._get_stories()
        await self.send(text_data=_send({'type': 'stories_snapshot', 'stories': stories}))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.GROUP, self.channel_name)

    async def receive(self, text_data):
        try:
            data   = json.loads(text_data)
            action = data.get('action')
        except json.JSONDecodeError:
            return

        if action == 'view':
            await self._handle_view(data)
        elif action == 'ping':
            await self.send(text_data=_send({'type': 'pong'}))

    async def _handle_view(self, data):
        story_id = data.get('story_id')
        if not story_id:
            return
        view = await self._create_view(story_id)
        await self.channel_layer.group_send(self.GROUP, {
            'type':     'ws_story_viewed',
            'view':     view,
            'story_id': story_id,
        })

    async def ws_story_viewed(self, event):
        await self.send(text_data=_send({
            'type':     'story_viewed',
            'view':     event['view'],
            'story_id': event['story_id'],
        }))

    async def ws_story_created(self, event):
        await self.send(text_data=_send({
            'type':  'story_created',
            'story': event['story'],
        }))

    @database_sync_to_async
    def _get_stories(self):
        from django.utils import timezone
        from django.db.models import Q
        from .models import Story
        from .serializers import StorySerializer
        req = type('Req', (), {'user': self.user})()
        followed = self.user.following.values_list('following', flat=True)
        qs = Story.objects.filter(
            Q(author=self.user) | Q(author__in=followed),
            expires_at__gt=timezone.now()
        ).select_related('author').prefetch_related('views').order_by('-created_at')[:50]
        return StorySerializer(qs, many=True, context={'request': req}).data

    @database_sync_to_async
    def _create_view(self, story_id):
        from .models import Story, StoryView
        from .serializers import StoryViewSerializer
        story = Story.objects.get(id=story_id)
        view, _ = StoryView.objects.get_or_create(story=story, viewer=self.user)
        return StoryViewSerializer(view).data
