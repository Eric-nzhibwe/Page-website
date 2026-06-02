"""
WebSocket consumers for real-time social features
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Post, Comment, PostReaction, Story, StoryView
from .serializers import CommentSerializer, PostReactionSerializer, StorySerializer, StoryViewSerializer
from users.models import User


class PostConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time post updates (comments, reactions, shares)
    """
    
    async def connect(self):
        self.post_id = self.scope['url_route']['kwargs']['post_id']
        self.post_group_name = f'post_{self.post_id}'
        
        # Join post group
        await self.channel_layer.group_add(
            self.post_group_name,
            self.channel_name
        )
        
        await self.accept()
    
    async def disconnect(self, close_code):
        # Leave post group
        await self.channel_layer.group_discard(
            self.post_group_name,
            self.channel_name
        )
    
    async def receive(self, text_data):
        data = json.loads(text_data)
        action = data.get('action')
        
        if action == 'comment':
            await self.handle_comment(data)
        elif action == 'react':
            await self.handle_reaction(data)
        elif action == 'share':
            await self.handle_share(data)
    
    async def handle_comment(self, data):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'error': 'Authentication required'
            }))
            return
        
        content = data.get('content')
        if not content:
            await self.send(text_data=json.dumps({
                'error': 'Content is required'
            }))
            return
        
        # Create comment
        comment = await self.create_comment(user, content)
        
        # Broadcast to group
        await self.channel_layer.group_send(
            self.post_group_name,
            {
                'type': 'comment_created',
                'comment': comment
            }
        )
    
    async def handle_reaction(self, data):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'error': 'Authentication required'
            }))
            return
        
        reaction_type = data.get('reaction_type', 'fire')
        
        # Create or update reaction
        reaction = await self.create_or_update_reaction(user, reaction_type)
        
        # Broadcast to group
        await self.channel_layer.group_send(
            self.post_group_name,
            {
                'type': 'reaction_updated',
                'reaction': reaction
            }
        )
    
    async def handle_share(self, data):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'error': 'Authentication required'
            }))
            return
        
        platform = data.get('platform')
        if not platform:
            await self.send(text_data=json.dumps({
                'error': 'Platform is required'
            }))
            return
        
        # Create share
        share = await self.create_share(user, platform)
        
        # Broadcast to group
        await self.channel_layer.group_send(
            self.post_group_name,
            {
                'type': 'post_shared',
                'share': share
            }
        )
    
    async def comment_created(self, event):
        await self.send(text_data=json.dumps({
            'type': 'comment_created',
            'comment': event['comment']
        }))
    
    async def reaction_updated(self, event):
        await self.send(text_data=json.dumps({
            'type': 'reaction_updated',
            'reaction': event['reaction']
        }))
    
    async def post_shared(self, event):
        await self.send(text_data=json.dumps({
            'type': 'post_shared',
            'share': event['share']
        }))
    
    @database_sync_to_async
    def create_comment(self, user, content):
        from .models import Comment
        post = Post.objects.get(id=self.post_id)
        comment = Comment.objects.create(
            post=post,
            author=user,
            content=content
        )
        serializer = CommentSerializer(comment)
        return serializer.data
    
    @database_sync_to_async
    def create_or_update_reaction(self, user, reaction_type):
        from .models import PostReaction
        post = Post.objects.get(id=self.post_id)
        reaction, created = PostReaction.objects.update_or_create(
            post=post,
            user=user,
            defaults={'reaction_type': reaction_type}
        )
        serializer = PostReactionSerializer(reaction)
        return serializer.data
    
    @database_sync_to_async
    def create_share(self, user, platform):
        from .models import PostShare
        post = Post.objects.get(id=self.post_id)
        share, created = PostShare.objects.get_or_create(
            post=post,
            user=user,
            platform=platform
        )
        return {
            'id': str(share.id),
            'platform': share.platform,
            'shared_at': share.shared_at.isoformat()
        }


class StoryConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time story updates and viewer tracking
    """
    
    async def connect(self):
        self.story_group_name = 'stories'
        
        # Join stories group
        await self.channel_layer.group_add(
            self.story_group_name,
            self.channel_name
        )
        
        await self.accept()
    
    async def disconnect(self, close_code):
        # Leave stories group
        await self.channel_layer.group_discard(
            self.story_group_name,
            self.channel_name
        )
    
    async def receive(self, text_data):
        data = json.loads(text_data)
        action = data.get('action')
        
        if action == 'view':
            await self.handle_story_view(data)
        elif action == 'create':
            await self.handle_story_create(data)
    
    async def handle_story_view(self, data):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'error': 'Authentication required'
            }))
            return
        
        story_id = data.get('story_id')
        if not story_id:
            await self.send(text_data=json.dumps({
                'error': 'Story ID is required'
            }))
            return
        
        # Create story view
        view = await self.create_story_view(user, story_id)
        
        # Broadcast to group
        await self.channel_layer.group_send(
            self.story_group_name,
            {
                'type': 'story_viewed',
                'view': view,
                'story_id': story_id
            }
        )
    
    async def handle_story_create(self, data):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.send(text_data=json.dumps({
                'error': 'Authentication required'
            }))
            return
        
        media_url = data.get('media_url')
        media_type = data.get('media_type', 'image')
        content = data.get('content', '')
        
        if not media_url:
            await self.send(text_data=json.dumps({
                'error': 'Media URL is required'
            }))
            return
        
        # Create story
        story = await self.create_story(user, media_url, media_type, content)
        
        # Broadcast to group
        await self.channel_layer.group_send(
            self.story_group_name,
            {
                'type': 'story_created',
                'story': story
            }
        )
    
    async def story_viewed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'story_viewed',
            'view': event['view'],
            'story_id': event['story_id']
        }))
    
    async def story_created(self, event):
        await self.send(text_data=json.dumps({
            'type': 'story_created',
            'story': event['story']
        }))
    
    @database_sync_to_async
    def create_story_view(self, user, story_id):
        from .models import StoryView
        story = Story.objects.get(id=story_id)
        view, created = StoryView.objects.get_or_create(
            story=story,
            viewer=user
        )
        serializer = StoryViewSerializer(view)
        return serializer.data
    
    @database_sync_to_async
    def create_story(self, user, media_url, media_type, content):
        from .models import Story
        story = Story.objects.create(
            author=user,
            media_url=media_url,
            media_type=media_type,
            content=content
        )
        serializer = StorySerializer(story)
        return serializer.data
