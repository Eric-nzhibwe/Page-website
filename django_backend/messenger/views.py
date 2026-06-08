from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Max
from .models import Conversation, Message
from .serializers import ConversationListSerializer, ConversationDetailSerializer, MessageSerializer
from users.models import User


class MessagePagination(PageNumberPagination):
    """Pagination for messages"""
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 100


class ConversationViewSet(viewsets.ModelViewSet):
    """Conversation management"""
    permission_classes = [IsAuthenticated]
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return ConversationDetailSerializer
        return ConversationListSerializer
    
    def get_queryset(self):
        return Conversation.objects.filter(participants=self.request.user).prefetch_related('participants', 'messages')
    
    @action(detail=False, methods=['post'])
    def start_conversation(self, request):
        """Start a new conversation with a user"""
        other_user_id = request.data.get('user_id')
        
        if not other_user_id:
            return Response({'error': 'user_id is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            other_user = User.objects.get(id=other_user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
        if other_user == request.user:
            return Response({'error': 'Cannot start conversation with yourself'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Check if conversation already exists
        conversation = Conversation.objects.filter(
            participants=request.user
        ).filter(
            participants=other_user
        ).first()
        
        if not conversation:
            # Create new conversation
            conversation = Conversation.objects.create()
            conversation.participants.add(request.user, other_user)
            print(f"✅ New conversation created between {request.user.username} and {other_user.username}")
        else:
            print(f"📱 Existing conversation found: {conversation.id}")
        
        serializer = ConversationListSerializer(conversation, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Get all messages in a conversation with pagination"""
        conversation = self.get_object()
        
        # Verify user is participant
        if request.user not in conversation.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        
        messages = conversation.messages.all().order_by('timestamp')
        
        # Mark messages as read
        unread_messages = messages.filter(read=False).exclude(sender=request.user)
        unread_count = unread_messages.count()
        if unread_count > 0:
            unread_messages.update(read=True)
            print(f"✅ Marked {unread_count} messages as read")
        
        # Apply pagination
        paginator = MessagePagination()
        page = paginator.paginate_queryset(messages, request)
        
        if page is not None:
            serializer = MessageSerializer(page, many=True, context={'request': request})
            return paginator.get_paginated_response(serializer.data)
        
        serializer = MessageSerializer(messages, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        """Send a message in a conversation (text or media)"""
        conversation = self.get_object()
        
        # Verify user is participant
        if request.user not in conversation.participants.all():
            return Response({'error': 'Not a participant'}, status=status.HTTP_403_FORBIDDEN)
        
        message_type = request.data.get('message_type', 'text')
        text = request.data.get('text', '').strip()
        media_file = request.FILES.get('media_file')
        
        # Validation
        if message_type == 'text' and not text:
            return Response({'error': 'Text message cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
        
        if message_type in ['image', 'video', 'audio', 'file'] and not media_file:
            return Response({'error': f'{message_type} file is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        # File size validation (10MB max)
        if media_file and media_file.size > 10 * 1024 * 1024:
            return Response({'error': 'File too large. Maximum size is 10MB.'}, status=status.HTTP_400_BAD_REQUEST)
        
        # File type validation
        if media_file:
            allowed_types = {
                'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                'video': ['video/mp4', 'video/webm', 'video/ogg'],
                'audio': ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm'],
            }
            
            if message_type in allowed_types:
                if media_file.content_type not in allowed_types[message_type]:
                    return Response({'error': f'Invalid file type for {message_type}'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Create message
        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            message_type=message_type,
            text=text if text else None,
            media_file=media_file if media_file else None
        )
        
        # Update conversation timestamp
        conversation.save()
        
        print(f"💬 {message_type.title()} message sent by {request.user.username} in conversation {conversation.id}")
        
        serializer = MessageSerializer(message, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def available_users_view(request):
    """Get list of users available to chat with"""
    # Exclude current user
    users = User.objects.exclude(id=request.user.id).order_by('-prestige_points')[:50]
    
    users_data = [{
        'id': user.id,
        'username': user.username,
        'display_name': user.display_name,
        'access_tier': user.access_tier,
        'prestige_points': user.prestige_points,
        'is_online': True  # TODO: Implement real online status
    } for user in users]
    
    return Response(users_data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def unread_count_view(request):
    """Get total unread message count"""
    unread_count = Message.objects.filter(
        conversation__participants=request.user,
        read=False
    ).exclude(sender=request.user).count()
    
    return Response({'unread_count': unread_count})
