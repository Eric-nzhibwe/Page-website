"""
WebSocket consumers for real-time social features
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.serializers.json import DjangoJSONEncoder
from .models import Post, Comment, Follow
from .serializers import PostSerializer, CommentSerializer, FollowSerializer
from users.models import User


class SocialFeedConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time social feed updates
    """
    
    async def connect(self):
        """Handle WebSocket connection"""
        self.user = self.scope["user"]
        self.room_group_name = f"social_feed_{self.user.id}"
        
        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
        
        # Send initial data
        await self.send_initial_data()
    
    async def disconnect(self, close_code):
        """Handle WebSocket disconnection"""
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
    
    async def receive(self, text_data):
        """Handle incoming WebSocket messages"""
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'fetch_feed':
                await self.send_feed_update()
            elif message_type == 'fetch_stories':
                await self.send_stories_update()
            elif message_type == 'fetch_online_users':
                await self.send_online_users()
            
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON")
    
    async def send_initial_data(self):
        """Send initial feed data"""
        await self.send_feed_update()
        await self.send_stories_update()
        await self.send_online_users()
    
    async def send_feed_update(self):
        """Send feed posts to client"""
        posts = await self.get_feed_posts()
        
        await self.send(text_data=json.dumps({
            'type': 'feed_update',
            'posts': posts
        }, cls=DjangoJSONEncoder))
    
    async def send_stories_update(self):
        """Send stories to client"""
        stories = await self.get_stories()
        
        await self.send(text_data=json.dumps({
            'type': 'stories_update',
            'stories': stories
        }, cls=DjangoJSONEncoder))
    
    async def send_online_users(self):
        """Send list of online users"""
        online_users = await self.get_online_users()
        
        await self.send(text_data=json.dumps({
            'type': 'online_users',
            'users': online_users
        }, cls=DjangoJSONEncoder))
    
    async def send_error(self, message):
        """Send error message"""
        await self.send(text_data=json.dumps({
            'type': 'error',
            'message': message
        }))
    
    # Receive messages from room group
    async def post_created(self, event):
        """Handle new post creation"""
        await self.send(text_data=json.dumps({
            'type': 'post_created',
            'post': event['post']
        }))
    
    async def post_updated(self, event):
        """Handle post update"""
        await self.send(text_data=json.dumps({
            'type': 'post_updated',
            'post': event['post']
        }))
    
    async def comment_created(self, event):
        """Handle new comment"""
        await self.send(text_data=json.dumps({
            'type': 'comment_created',
            'comment': event['comment'],
            'post_id': event['post_id']
        }))
    
    async def user_followed(self, event):
        """Handle user follow"""
        await self.send(text_data=json.dumps({
            'type': 'user_followed',
            'follower': event['follower'],
            'following': event['following']
        }))
    
    async def user_online(self, event):
        """Handle user coming online"""
        await self.send(text_data=json.dumps({
            'type': 'user_online',
            'user': event['user']
        }))
    
    async def user_offline(self, event):
        """Handle user going offline"""
        await self.send(text_data=json.dumps({
            'type': 'user_offline',
            'user_id': event['user_id']
        }))
    
    # Database queries
    @database_sync_to_async
    def get_feed_posts(self):
        """Get feed posts for current user"""
        user = self.user
        followed_users = user.following.values_list('following', flat=True)
        
        posts = Post.objects.filter(
            Q(author=user) | Q(author__in=followed_users)
        ).select_related('author').prefetch_related(
            'comments', 'reactions', 'shares'
        ).order_by('-created_at')[:50]
        
        serializer = PostSerializer(posts, many=True, context={'request': self.scope['request']})
        return serializer.data
    
    @database_sync_to_async
    def get_stories(self):
        """Get stories from followed users"""
        user = self.user
        followed_users = user.following.values_list('following', flat=True)
        
        stories = []
        
        # Add user's own story
        stories.append({
            'id': f'story_{user.id}',
            'user_id': user.id,
            'username': user.username,
            'display_name': user.display_name or user.username,
            'profile_image': user.profile_image,
            'type': 'own'
        })
        
        # Add followed users' stories
        for followed_user in User.objects.filter(id__in=followed_users):
            stories.append({
                'id': f'story_{followed_user.id}',
                'user_id': followed_user.id,
                'username': followed_user.username,
                'display_name': followed_user.display_name or followed_user.username,
                'profile_image': followed_user.profile_image,
                'type': 'user'
            })
        
        return stories
    
    @database_sync_to_async
    def get_online_users(self):
        """Get list of online users"""
        # Get all users except current user
        users = User.objects.exclude(id=self.user.id).values(
            'id', 'username', 'display_name', 'profile_image'
        )[:100]
        
        return list(users)


class NotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time notifications
    """
    
    async def connect(self):
        """Handle WebSocket connection"""
        self.user = self.scope["user"]
        self.room_group_name = f"notifications_{self.user.id}"
        
        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        await self.accept()
    
    async def disconnect(self, close_code):
        """Handle WebSocket disconnection"""
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )
    
    # Receive messages from room group
    async def send_notification(self, event):
        """Send notification to client"""
        await self.send(text_data=json.dumps({
            'type': 'notification',
            'title': event['title'],
            'message': event['message'],
            'icon': event.get('icon', 'info'),
            'timestamp': event.get('timestamp')
        }))
    
    async def follow_notification(self, event):
        """Send follow notification"""
        await self.send(text_data=json.dumps({
            'type': 'follow_notification',
            'follower_id': event['follower_id'],
            'follower_name': event['follower_name'],
            'follower_image': event['follower_image'],
            'timestamp': event.get('timestamp')
        }))
    
    async def comment_notification(self, event):
        """Send comment notification"""
        await self.send(text_data=json.dumps({
            'type': 'comment_notification',
            'commenter_id': event['commenter_id'],
            'commenter_name': event['commenter_name'],
            'post_id': event['post_id'],
            'comment_preview': event['comment_preview'],
            'timestamp': event.get('timestamp')
        }))


from django.db.models import Q
