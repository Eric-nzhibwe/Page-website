"""
Chatbot views
"""
from django.conf import settings
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from .models import ChatConversation, ChatMessage
from .serializers import (
    ChatConversationSerializer,
    ChatMessageSerializer,
    ChatRequestSerializer,
)


def _use_firestore():
    return settings.FIRESTORE_COLLECTIONS.get('chatbot', False)


# ─────────────────────────────────────────────────────────────────────────────
#  Main chat endpoint
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def chat_view(request):
    """Send message to AI chatbot and get response."""
    serializer = ChatRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    message         = serializer.validated_data['message']
    conversation_id = serializer.validated_data.get('conversation_id')

    if _use_firestore():
        return _chat_firestore(request, message, conversation_id)
    return _chat_postgres(request, message, conversation_id)


def _chat_firestore(request, message, conversation_id):
    """Chat logic backed by Firestore."""
    from .firestore_chat_service import (
        create_conversation, get_conversation,
        save_message, get_messages,
    )

    user = request.user

    # ── Get or create conversation ────────────────────────────────────────
    if conversation_id:
        conv = get_conversation(user, conversation_id)
        if conv is None:
            return Response({'error': 'Conversation not found.'}, status=404)
    else:
        title = message[:50] + '…' if len(message) > 50 else message
        conv  = create_conversation(user, title=title)
        if conv is None:
            return Response({'error': 'Could not create conversation.'}, status=500)
        conversation_id = conv['id']

    # ── Save user message ─────────────────────────────────────────────────
    user_msg = save_message(user, conversation_id, role='user', content=message)

    # ── Build history for AI ──────────────────────────────────────────────
    history = [
        {'role': m['role'], 'content': m['content']}
        for m in get_messages(user, conversation_id, limit=20)
    ]

    # ── Call AI ───────────────────────────────────────────────────────────
    ai_response, ai_source = _call_ai(message, history, request.user)

    # ── Save AI reply ─────────────────────────────────────────────────────
    ai_msg = save_message(user, conversation_id, role='assistant', content=ai_response)

    return Response({
        'conversation_id': conversation_id,
        'user_message':    user_msg,
        'ai_message':      ai_msg,
        'ai_source':       ai_source,
    })


def _chat_postgres(request, message, conversation_id):
    """Chat logic backed by PostgreSQL (original implementation)."""
    user = request.user

    if conversation_id:
        conversation = get_object_or_404(ChatConversation, id=conversation_id, user=user)
    else:
        title        = message[:50] + '…' if len(message) > 50 else message
        conversation = ChatConversation.objects.create(user=user, title=title)

    user_message = ChatMessage.objects.create(
        conversation=conversation, role='user', content=message
    )

    prior = ChatMessage.objects.filter(
        conversation=conversation
    ).order_by('created_at')[:20]
    history = [{'role': m.role if m.role == 'user' else 'assistant', 'content': m.content}
               for m in prior]

    ai_response, ai_source = _call_ai(message, history, user)

    ai_message = ChatMessage.objects.create(
        conversation=conversation, role='assistant', content=ai_response
    )

    return Response({
        'conversation_id': conversation.id,
        'user_message':    ChatMessageSerializer(user_message).data,
        'ai_message':      ChatMessageSerializer(ai_message).data,
        'ai_source':       ai_source,
    })


def _call_ai(message, history, user):
    """
    Try Groq first; fall back to rule-based.
    Returns (response_text, source_label).
    """
    user_context = {
        'username':       user.username,
        'prestige_points': getattr(user, 'prestige_points', None),
        'tier':            getattr(user, 'access_tier', None),
    }
    try:
        from payments.models import Wallet
        wallet = Wallet.objects.get(user=user)
        user_context['wallet_balance'] = float(wallet.available_balance)
    except Exception:
        pass

    from django.conf import settings as _s
    groq_key = getattr(_s, 'GROQ_API_KEY', '').strip()
    if groq_key:
        from .ai_service import _groq_response
        resp = _groq_response(message, history, user_context)
        if resp:
            return resp, 'groq'

    from .ai_service import _rule_based_response
    return _rule_based_response(message, user_context), 'fallback'


# ─────────────────────────────────────────────────────────────────────────────
#  Conversation management
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation_list_view(request):
    """Get user's chat conversations."""
    if _use_firestore():
        from .firestore_chat_service import list_conversations
        data = list_conversations(request.user, limit=20)
        return Response({'conversations': data})

    conversations = ChatConversation.objects.filter(user=request.user)[:20]
    return Response({'conversations': ChatConversationSerializer(conversations, many=True).data})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation_detail_view(request, conversation_id):
    """Get conversation with messages."""
    if _use_firestore():
        from .firestore_chat_service import get_conversation, get_messages
        conv = get_conversation(request.user, conversation_id)
        if conv is None:
            return Response({'error': 'Not found.'}, status=404)
        conv['messages'] = get_messages(request.user, conversation_id, limit=200)
        return Response(conv)

    conversation = get_object_or_404(
        ChatConversation, id=conversation_id, user=request.user
    )
    return Response(ChatConversationSerializer(conversation).data)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def conversation_delete_view(request, conversation_id):
    """Delete conversation."""
    if _use_firestore():
        from .firestore_chat_service import delete_conversation
        ok = delete_conversation(request.user, conversation_id)
        if not ok:
            return Response({'error': 'Not found.'}, status=404)
        return Response({'message': 'Conversation deleted'})

    conversation = get_object_or_404(
        ChatConversation, id=conversation_id, user=request.user
    )
    conversation.delete()
    return Response({'message': 'Conversation deleted'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def conversation_new_view(request):
    """Start new conversation."""
    if _use_firestore():
        from .firestore_chat_service import create_conversation
        conv = create_conversation(request.user, title='New Conversation')
        if conv is None:
            return Response({'error': 'Could not create conversation.'}, status=500)
        return Response({'conversation_id': conv['id'], 'message': 'New conversation started'})

    conversation = ChatConversation.objects.create(
        user=request.user, title='New Conversation'
    )
    return Response({'conversation_id': conversation.id, 'message': 'New conversation started'})


# ─────────────────────────────────────────────────────────────────────────────
#  AI status
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def ai_status_view(request):
    """
    Actually tests the Groq API with a real call so the status is guaranteed.
    Returns engine info + whether a live test message succeeded.
    """
    import requests as http
    from django.conf import settings as django_settings

    groq_key = getattr(django_settings, 'GROQ_API_KEY', '').strip()

    if not groq_key:
        return Response({
            'engine': 'fallback',
            'model':  'rule-based',
            'status': 'limited',
            'label':  'Basic Mode — no API key set',
            'tested': False,
        })

    try:
        resp = http.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {groq_key}',
                'Content-Type':  'application/json',
            },
            json={
                'model':      'openai/gpt-oss-20b',
                'messages':   [{'role': 'user', 'content': 'Reply with exactly: OK'}],
                'max_tokens': 5,
            },
            timeout=10,
        )
        if resp.status_code == 200:
            return Response({
                'engine': 'groq',
                'model':  'openai/gpt-oss-20b',
                'status': 'online',
                'label':  'GPT-OSS 20B',
                'tested': True,
            })
        error = resp.json().get('error', {}).get('message', resp.text[:100])
        return Response({
            'engine': 'fallback',
            'model':  'rule-based',
            'status': 'error',
            'label':  f'Groq error: {error}',
            'tested': True,
        })
    except Exception as e:
        return Response({
            'engine': 'fallback',
            'model':  'rule-based',
            'status': 'error',
            'label':  f'Connection failed: {str(e)[:80]}',
            'tested': True,
        })

