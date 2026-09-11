from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q, Max
from django.utils import timezone
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
        return (
            Conversation.objects
            .filter(participants=self.request.user)
            .prefetch_related('participants', 'messages')
            .order_by('-updated_at')
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx['request'] = self.request
        return ctx

    @action(detail=False, methods=['post'])
    def start_conversation(self, request):
        """Find or create a 1-on-1 conversation with another user."""
        other_user_id = request.data.get('user_id')

        if not other_user_id:
            return Response({'error': 'user_id is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            other_user = User.objects.get(id=other_user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'},
                            status=status.HTTP_404_NOT_FOUND)

        if other_user == request.user:
            return Response({'error': 'Cannot start a conversation with yourself'},
                            status=status.HTTP_400_BAD_REQUEST)

        # Find existing 1-on-1 conversation
        conversation = (
            Conversation.objects
            .filter(participants=request.user)
            .filter(participants=other_user)
            .first()
        )

        if not conversation:
            conversation = Conversation.objects.create()
            conversation.participants.add(request.user, other_user)

        serializer = ConversationListSerializer(
            conversation, context={'request': request}
        )
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def messages(self, request, pk=None):
        """Get messages in a conversation, oldest first, with pagination."""
        conversation = self.get_object()

        if request.user not in conversation.participants.all():
            return Response({'error': 'Not a participant'},
                            status=status.HTTP_403_FORBIDDEN)

        msgs = conversation.messages.all().order_by('timestamp')

        # Mark incoming messages as read
        unread = msgs.filter(read=False).exclude(sender=request.user)
        unread_count = unread.count()
        if unread_count:
            unread.update(read=True)

        paginator = MessagePagination()
        page = paginator.paginate_queryset(msgs, request)
        if page is not None:
            serializer = MessageSerializer(page, many=True,
                                           context={'request': request})
            return paginator.get_paginated_response(serializer.data)

        serializer = MessageSerializer(msgs, many=True,
                                        context={'request': request})
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def send_message(self, request, pk=None):
        """Send a text or media message in a conversation."""
        conversation = self.get_object()

        if request.user not in conversation.participants.all():
            return Response({'error': 'Not a participant'},
                            status=status.HTTP_403_FORBIDDEN)

        message_type = request.data.get('message_type', 'text')
        text         = request.data.get('text', '').strip()
        media_file   = request.FILES.get('media_file')
        duration     = request.data.get('duration')  # seconds, sent by client for audio

        if message_type == 'text' and not text:
            return Response({'error': 'Message text cannot be empty'},
                            status=status.HTTP_400_BAD_REQUEST)

        if message_type in ('image', 'video', 'audio', 'file') and not media_file:
            return Response({'error': f'{message_type} file is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        if media_file and media_file.size > 10 * 1024 * 1024:
            return Response({'error': 'File too large (max 10 MB)'},
                            status=status.HTTP_400_BAD_REQUEST)

        if media_file:
            allowed = {
                'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
                'video': ['video/mp4', 'video/webm', 'video/ogg'],
                'audio': [
                    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
                    'audio/webm;codecs=opus',
                    'audio/ogg;codecs=opus',
                    'audio/mp4',
                ],
            }
            if message_type in allowed and media_file.content_type not in allowed[message_type]:
                return Response({'error': f'Invalid file type for {message_type}'},
                                status=status.HTTP_400_BAD_REQUEST)

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            message_type=message_type,
            text=text or None,
            media_file=media_file or None,
            media_duration=int(duration) if duration and str(duration).isdigit() else None,
        )
        conversation.save()  # bumps updated_at for sidebar ordering

        serializer = MessageSerializer(message, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def available_users_view(request):
    """
    Return users available to message.

    Priority order:
      1. Users the current user already follows
      2. Users who recently logged in (active in the last 30 days)
      3. Everyone else, sorted by prestige

    Excludes the requesting user and supports ?q= search filtering.
    Returns up to 50 results.
    """
    import logging
    from datetime import timedelta

    logger = logging.getLogger(__name__)

    try:
        q = request.query_params.get('q', '').strip()
        thirty_days_ago = timezone.now() - timedelta(days=30)

        # Build base queryset excluding self
        qs = User.objects.filter(is_active=True).exclude(id=request.user.id)

        # Apply search filter if provided
        if q:
            qs = qs.filter(
                Q(username__icontains=q) | Q(display_name__icontains=q)
            )

        # Resolve followed user IDs safely
        try:
            from social.models import Follow
            followed_ids = set(
                Follow.objects.filter(follower=request.user)
                .values_list('following_id', flat=True)
            )
        except Exception:
            followed_ids = set()

        # Sort: followed first, then by prestige — avoid complex Case/When
        # that can crash when last_login is NULL for Firebase-auth users.
        users_list = list(qs.order_by('-prestige_points')[:200])

        def sort_key(u):
            if u.id in followed_ids:
                return 0
            if u.last_login is not None and u.last_login >= thirty_days_ago:
                return 1
            return 2

        users_list.sort(key=sort_key)
        users_list = users_list[:50]

        users_data = []
        for user in users_list:
            profile_image_url = None
            try:
                if user.profile_image and user.profile_image.storage.exists(user.profile_image.name):
                    profile_image_url = request.build_absolute_uri(user.profile_image.url)
            except Exception:
                pass

            users_data.append({
                'id':              user.id,
                'username':        user.username,
                'display_name':    user.display_name or user.username,
                'access_tier':     user.access_tier,
                'prestige_points': user.prestige_points,
                'profile_image':   profile_image_url,
                'is_following':    user.id in followed_ids,
                # Approximate online: logged in within last 30 days
                'is_active': (
                    user.last_login is not None
                    and user.last_login >= thirty_days_ago
                ),
            })

        return Response(users_data)

    except Exception as exc:
        logger.error(f'available_users_view error: {exc}', exc_info=True)
        return Response(
            {'error': 'Could not load users. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def unread_count_view(request):
    """Total unread message count for the current user."""
    count = Message.objects.filter(
        conversation__participants=request.user,
        read=False,
    ).exclude(sender=request.user).count()

    return Response({'unread_count': count})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def firebase_config_view(request):
    """
    Return the public Firebase web SDK config so the messenger frontend
    can initialise Firestore listeners.  All values are non-secret.
    Returns empty dict when Firebase is not configured.
    """
    from artx_platform.firebase_client import firebase_enabled
    if not firebase_enabled():
        return Response({})
    from .firestore_messenger_service import get_firebase_config
    return Response(get_firebase_config())


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_read_view(request, conversation_id):
    """
    Mark all unread messages in a conversation as read for the current user.
    Updates both PostgreSQL and Firestore.
    """
    try:
        conv = Conversation.objects.get(id=conversation_id,
                                        participants=request.user)
    except Conversation.DoesNotExist:
        return Response({'error': 'Conversation not found'},
                        status=status.HTTP_404_NOT_FOUND)

    updated = (Message.objects
               .filter(conversation=conv, read=False)
               .exclude(sender=request.user)
               .update(read=True))

    # Mirror the zeroed unread count to Firestore (best-effort)
    try:
        from artx_platform.firebase_client import firebase_enabled
        if firebase_enabled():
            from .firestore_messenger_service import mark_read_in_firestore
            mark_read_in_firestore(conversation_id, str(request.user.id))
    except Exception:
        pass

    return Response({'marked_read': updated})

