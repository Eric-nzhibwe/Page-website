"""
Chatbot views — PAGE Platform
==============================
Endpoints
---------
POST   /api/chatbot/chat/                 — text chat
POST   /api/chatbot/media/                — image / file / voice
GET    /api/chatbot/sessions/             — list user's sessions (sidebar)
GET    /api/chatbot/sessions/<id>/        — full session with messages
DELETE /api/chatbot/sessions/<id>/        — delete a session
GET    /api/chatbot/status/               — live Groq ping (cached 60 s)
"""
import base64
import logging
import mimetypes
import os
import tempfile

import requests as http
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import status as drf_status
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .ai_service import get_ai_response, groq_vision, groq_transcribe, rule_based
from .models import ChatMessage, ChatSession
from .serializers import ChatMessageSerializer, ChatSessionListSerializer, ChatSessionSerializer
from . import firestore_chatbot_service as fs_chat

_FS_ENABLED = lambda: getattr(settings, 'FIRESTORE_COLLECTIONS', {}).get('chatbot', False)

logger = logging.getLogger(__name__)

MAX_HISTORY   = 20   # messages sent to AI as context
MAX_AUDIO_MB  = 25
MAX_IMAGE_MB  = 10
MAX_FILE_MB   = 5


# ── Helpers ────────────────────────────────────────────────────────────────────

def _api_key() -> str:
    return getattr(settings, 'GROQ_API_KEY', '').strip()


def _user_ctx(user) -> dict:
    ctx = {
        'username':        user.username,
        'prestige_points': getattr(user, 'prestige_points', None),
        'tier':            getattr(user, 'access_tier', None),
    }
    try:
        from payments.models import Wallet
        ctx['wallet_balance'] = float(Wallet.objects.get(user=user).available_balance)
    except Exception:
        pass
    return ctx


def _get_or_create_session(user, session_id: str | None, first_message: str) -> ChatSession:
    if session_id:
        try:
            return ChatSession.objects.get(id=int(session_id), user=user)
        except (ChatSession.DoesNotExist, ValueError, TypeError):
            pass
    title   = (first_message[:60] + '…') if len(first_message) > 60 else first_message
    session = ChatSession.objects.create(user=user, title=title)
    if _FS_ENABLED():
        # Refresh so created_at/updated_at are populated before mirroring
        session.refresh_from_db()
        fs_chat.mirror_new_session(session)
    return session


def _build_history(session: ChatSession) -> list:
    msgs = session.messages.order_by('created_at')[:MAX_HISTORY]
    return [{'role': m.role, 'content': m.content} for m in msgs]


def _persist(session: ChatSession, user_text: str, ai_text: str,
             ai_source: str, user_meta: dict | None = None) -> dict:
    """Save both turns and return a response dict."""
    user_msg = ChatMessage.objects.create(
        session=session, role=ChatMessage.ROLE_USER,
        content=user_text, meta=user_meta or {},
    )
    ai_msg = ChatMessage.objects.create(
        session=session, role=ChatMessage.ROLE_ASSISTANT,
        content=ai_text, meta={'source': ai_source},
    )
    # Touch updated_at so the session sorts to the top
    ChatSession.objects.filter(pk=session.pk).update(updated_at=ai_msg.created_at)

    # Mirror both messages to Firestore (non-fatal if it fails)
    if _FS_ENABLED():
        session.refresh_from_db()   # pick up the new updated_at
        fs_chat.mirror_message_pair(session, user_msg, ai_msg)

    return {
        'session_id': session.id,
        'reply':      ai_text,
        'ai_source':  ai_source,
        'message':    ChatMessageSerializer(ai_msg).data,
    }


# ── Text chat ──────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def chat(request):
    """
    Body: { "message": "...", "session_id": <int|null> }
    """
    text       = (request.data.get('message') or '').strip()
    session_id = request.data.get('session_id')

    if not text:
        return Response({'error': 'message is required'}, status=400)
    if len(text) > 2000:
        return Response({'error': 'message too long (max 2000 chars)'}, status=400)

    session = _get_or_create_session(request.user, session_id, text)
    history = _build_history(session)
    reply, source = get_ai_response(text, history, _user_ctx(request.user))
    return Response(_persist(session, text, reply, source))


# ── Media chat (image / file + optional text) ──────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def media_chat(request):
    """
    Form fields: message (optional), file (image/pdf/txt), session_id (optional)
    """
    groq_key = _api_key()
    if not groq_key:
        return Response({'error': 'AI unavailable — GROQ_API_KEY not configured'}, status=503)

    message    = (request.data.get('message') or '').strip()
    session_id = request.data.get('session_id')
    uploaded   = request.FILES.get('file')

    if not message and not uploaded:
        return Response({'error': 'Provide a message or a file'}, status=400)

    # ── Detect file type ───────────────────────────────────────────────────
    file_ctx   = ''
    image_b64  = None
    image_mime = None
    display_msg = message

    if uploaded:
        mime = uploaded.content_type or ''
        if not mime.startswith('image/'):
            guessed, _ = mimetypes.guess_type(uploaded.name)
            if guessed:
                mime = guessed

        if mime.startswith('image/'):
            if uploaded.size > MAX_IMAGE_MB * 1024 * 1024:
                return Response({'error': f'Image too large (max {MAX_IMAGE_MB} MB)'}, status=400)
            image_b64  = base64.b64encode(uploaded.read()).decode()
            image_mime = mime
            display_msg = f'{message}\n📎 {uploaded.name}' if message else f'[Image: {uploaded.name}]'

        elif mime in ('text/plain', 'text/csv', 'text/markdown'):
            if uploaded.size > MAX_FILE_MB * 1024 * 1024:
                return Response({'error': f'File too large (max {MAX_FILE_MB} MB)'}, status=400)
            try:
                txt      = uploaded.read().decode('utf-8', errors='replace')
                file_ctx = f'\n\n[Attached: {uploaded.name}]\n```\n{txt[:4000]}\n```'
            except Exception:
                file_ctx = f'\n\n[Attached: {uploaded.name} — could not read content]'
            display_msg = f'{message}\n📎 {uploaded.name}' if message else f'📎 {uploaded.name}'

        elif mime == 'application/pdf':
            file_ctx    = _pdf_text(uploaded)
            display_msg = f'{message}\n📎 {uploaded.name}' if message else f'📎 {uploaded.name}'

        else:
            file_ctx    = f'\n\n[Attached: {uploaded.name} (type: {mime}) — not readable]'
            display_msg = f'{message}\n📎 {uploaded.name}' if message else f'📎 {uploaded.name}'

    session = _get_or_create_session(request.user, session_id, display_msg)
    user_ctx = _user_ctx(request.user)

    if image_b64:
        reply, source = groq_vision(
            message or 'What do you see in this image?',
            image_b64, image_mime, user_ctx, groq_key,
        )
    else:
        full_message  = (message or 'Can you help me with this file?') + file_ctx
        history       = _build_history(session)
        reply, source = get_ai_response(full_message, history, user_ctx)

    return Response(_persist(session, display_msg, reply, source,
                             user_meta={'type': 'image' if image_b64 else 'file'}))


def _pdf_text(pdf_file) -> str:
    try:
        from pdfminer.high_level import extract_text
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            for chunk in pdf_file.chunks():
                tmp.write(chunk)
            tmp_path = tmp.name
        try:
            text = extract_text(tmp_path)[:4000].strip()
            return f'\n\n[Attached PDF: {pdf_file.name}]\n```\n{text}\n```'
        finally:
            os.unlink(tmp_path)
    except ImportError:
        return f'\n\n[Attached PDF: {pdf_file.name} — install pdfminer.six to enable PDF reading]'
    except Exception as exc:
        return f'\n\n[Attached PDF: {pdf_file.name} — could not extract text: {exc}]'


# ── Voice transcription ────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def transcribe(request):
    """
    Form field: audio (webm/ogg/mp3/wav/m4a)
    Returns: { transcript, duration_seconds }
    """
    groq_key = _api_key()
    if not groq_key:
        return Response({'error': 'Transcription unavailable — GROQ_API_KEY not configured'}, status=503)

    audio = request.FILES.get('audio')
    if not audio:
        return Response({'error': 'No audio file provided'}, status=400)
    if audio.size > MAX_AUDIO_MB * 1024 * 1024:
        return Response({'error': f'Audio too large (max {MAX_AUDIO_MB} MB)'}, status=400)

    mime    = audio.content_type or 'audio/webm'
    ext_map = {'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
               'audio/mp4': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav'}
    ext     = ext_map.get(mime, '.webm')

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        for chunk in audio.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        transcript = groq_transcribe(tmp_path, ext, mime, groq_key)
    finally:
        os.unlink(tmp_path)

    if not transcript:
        return Response({'error': 'Could not understand audio — please speak clearly and try again'}, status=422)

    return Response({'transcript': transcript})


# ── Session management ─────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def session_list(request):
    """Return the user's 20 most recent sessions (no messages — for the sidebar)."""
    sessions = ChatSession.objects.filter(user=request.user)[:20]
    return Response({'sessions': ChatSessionListSerializer(sessions, many=True).data})


@api_view(['GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def session_detail(request, session_id):
    session = get_object_or_404(ChatSession, id=session_id, user=request.user)

    if request.method == 'DELETE':
        user_id    = session.user_id
        session_id = session.id
        session.delete()
        if _FS_ENABLED():
            fs_chat.mirror_session_delete(user_id, session_id)
        return Response({'ok': True})

    return Response(ChatSessionSerializer(session).data)


# ── Groq status ping ───────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def status(request):
    """
    Live Groq ping — 1-token request to verify the key and model are both valid.
    Result cached per-user for 60 s to avoid hammering the API on every page load.
    """
    from django.core.cache import cache
    from .ai_service import PRIMARY_MODEL, FALLBACK_MODEL

    groq_key = _api_key()
    if not groq_key:
        return Response({'engine': 'fallback', 'status': 'limited',
                         'label': 'Basic Mode', 'reason': 'GROQ_API_KEY not set'})

    cache_key = f'groq_status_{request.user.id}'
    cached    = cache.get(cache_key)
    if cached:
        return Response(cached)

    def _ping(model_id):
        return http.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {groq_key}', 'Content-Type': 'application/json'},
            json={'model': model_id, 'messages': [{'role': 'user', 'content': 'ping'}], 'max_tokens': 1},
            timeout=10,
        )

    try:
        resp         = _ping(PRIMARY_MODEL)
        active_model = PRIMARY_MODEL
        if resp.status_code in (400, 404):
            resp         = _ping(FALLBACK_MODEL)
            active_model = FALLBACK_MODEL

        if resp.status_code == 200:
            result = {'engine': 'groq', 'model': active_model,
                      'status': 'online', 'label': 'PAGE AI'}
            cache.set(cache_key, result, 60)
            return Response(result)

        try:
            reason = resp.json().get('error', {}).get('message', resp.text[:200])
        except Exception:
            reason = resp.text[:200]
        logger.error(f'Groq status ping failed ({resp.status_code}): {reason}')
        result = {'engine': 'fallback', 'status': 'error',
                  'label': 'Basic Mode', 'reason': reason}
        cache.set(cache_key, result, 30)
        return Response(result)

    except Exception as exc:
        logger.warning(f'Groq status check exception: {exc}')
        result = {'engine': 'groq', 'model': PRIMARY_MODEL,
                  'status': 'online', 'label': 'PAGE AI',
                  'reason': 'Status check timed out — assuming online'}
        cache.set(cache_key, result, 30)
        return Response(result)
