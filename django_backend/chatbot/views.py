"""
Chatbot views
"""
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from .models import ChatConversation, ChatMessage
from .serializers import (
    ChatConversationSerializer,
    ChatMessageSerializer,
    ChatRequestSerializer
)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def chat_view(request):
    """
    Send message to AI chatbot and get response
    """
    serializer = ChatRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    message = serializer.validated_data['message']
    conversation_id = serializer.validated_data.get('conversation_id')
    
    # Get or create conversation
    if conversation_id:
        conversation = get_object_or_404(ChatConversation, id=conversation_id, user=request.user)
    else:
        # Create new conversation with title from first message
        title = message[:50] + '...' if len(message) > 50 else message
        conversation = ChatConversation.objects.create(
            user=request.user,
            title=title
        )
    
    # Save user message
    user_message = ChatMessage.objects.create(
        conversation=conversation,
        role='user',
        content=message
    )
    
    # Get user context for AI
    user_context = {
        'username': request.user.username,
        'prestige_points': getattr(request.user, 'prestige_points', None),
        'tier': getattr(request.user, 'access_tier', None),
    }

    # Add wallet balance if available
    try:
        from payments.models import Wallet
        wallet = Wallet.objects.get(user=request.user)
        user_context['wallet_balance'] = float(wallet.available_balance)
    except Exception:
        pass

    # Build conversation history for multi-turn memory (last 20 messages)
    prior_messages = ChatMessage.objects.filter(
        conversation=conversation
    ).order_by('created_at')[:20]

    history = [
        {"role": "user" if msg.role == "user" else "assistant", "content": msg.content}
        for msg in prior_messages
    ]

    # Try Groq — track whether it actually responded
    ai_response = None
    ai_source   = 'fallback'

    from django.conf import settings as django_settings
    groq_key = getattr(django_settings, 'GROQ_API_KEY', '').strip()

    if groq_key:
        from .ai_service import _groq_response
        ai_response = _groq_response(message, history, user_context)
        if ai_response:
            ai_source = 'groq'

    # Fall back to rule-based if Groq didn't answer
    if not ai_response:
        from .ai_service import _rule_based_response
        ai_response = _rule_based_response(message, user_context)

    # Save AI message
    ai_message = ChatMessage.objects.create(
        conversation=conversation,
        role='assistant',
        content=ai_response
    )

    return Response({
        'conversation_id': conversation.id,
        'user_message': ChatMessageSerializer(user_message).data,
        'ai_message': ChatMessageSerializer(ai_message).data,
        'ai_source': ai_source,
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation_list_view(request):
    """Get user's chat conversations"""
    conversations = ChatConversation.objects.filter(user=request.user)[:20]
    serializer = ChatConversationSerializer(conversations, many=True)
    return Response({'conversations': serializer.data})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation_detail_view(request, conversation_id):
    """Get conversation with messages"""
    conversation = get_object_or_404(ChatConversation, id=conversation_id, user=request.user)
    serializer = ChatConversationSerializer(conversation)
    return Response(serializer.data)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def conversation_delete_view(request, conversation_id):
    """Delete conversation"""
    conversation = get_object_or_404(ChatConversation, id=conversation_id, user=request.user)
    conversation.delete()
    return Response({'message': 'Conversation deleted'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def conversation_new_view(request):
    """Start new conversation"""
    conversation = ChatConversation.objects.create(
        user=request.user,
        title='New Conversation'
    )
    return Response({
        'conversation_id': conversation.id,
        'message': 'New conversation started'
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def ai_status_view(request):
    """
    Returns which AI engine is active.
    Frontend uses this to show the status badge.
    """
    from django.conf import settings as django_settings
    import importlib.util

    groq_key = getattr(django_settings, 'GROQ_API_KEY', '').strip()
    groq_pkg = importlib.util.find_spec('groq') is not None

    if groq_key and groq_pkg:
        return Response({
            'engine': 'groq',
            'model':  'llama-3.3-70b-versatile',
            'status': 'online',
            'label':  'LLaMA 3.3 70B',
        })
    return Response({
        'engine': 'fallback',
        'model':  'rule-based',
        'status': 'limited',
        'label':  'Basic Mode',
    })
