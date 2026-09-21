"""
Chatbot media views — voice transcription + image/file chat
============================================================
POST /api/chatbot/transcribe/
    Accepts a voice recording (webm/ogg/mp3/wav), transcribes it via
    Groq Whisper, returns the transcript so the frontend can send it
    as a normal chat message OR display it for the user to confirm.

POST /api/chatbot/media-chat/
    Accepts a text message + optional image/file attachment.
    For images: encodes to base64, sends to Groq vision model.
    For other files (PDF, txt, etc.): extracts text content and
    includes it in the prompt context.

Both endpoints require authentication (Token).
"""
import base64
import io
import logging
import mimetypes
import os
import tempfile

import requests as http
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .views import _call_ai, _chat_postgres, _chat_firestore, _use_firestore

logger = logging.getLogger(__name__)

GROQ_WHISPER_URL  = 'https://api.groq.com/openai/v1/audio/transcriptions'
GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'   # Groq vision model
GROQ_API_URL      = 'https://api.groq.com/openai/v1/chat/completions'

MAX_AUDIO_MB  = 25     # Groq Whisper limit
MAX_IMAGE_MB  = 10
MAX_FILE_MB   = 5


# ─────────────────────────────────────────────────────────────────────────────
#  Voice transcription
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def transcribe_voice(request):
    """
    Transcribe an audio file using Groq Whisper-large-v3.

    Form fields:
        audio  — audio file (webm, ogg, mp3, wav, m4a)

    Returns:
        { transcript: "...", duration_seconds: N }
    """
    groq_key = getattr(settings, 'GROQ_API_KEY', '').strip()
    if not groq_key:
        return Response({'error': 'Transcription unavailable — GROQ_API_KEY not configured.'}, status=503)

    audio_file = request.FILES.get('audio')
    if not audio_file:
        return Response({'error': 'No audio file provided.'}, status=400)

    # Size check
    if audio_file.size > MAX_AUDIO_MB * 1024 * 1024:
        return Response({'error': f'Audio file too large (max {MAX_AUDIO_MB} MB).'}, status=400)

    # Detect mime type
    mime = audio_file.content_type or 'audio/webm'
    ext_map = {
        'audio/webm':  '.webm',
        'audio/ogg':   '.ogg',
        'audio/mpeg':  '.mp3',
        'audio/mp4':   '.m4a',
        'audio/wav':   '.wav',
        'audio/x-wav': '.wav',
    }
    ext = ext_map.get(mime, '.webm')

    # Write to a temp file (Groq needs a real filename with extension)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        for chunk in audio_file.chunks():
            tmp.write(chunk)
        tmp_path = tmp.name

    try:
        with open(tmp_path, 'rb') as f:
            resp = http.post(
                GROQ_WHISPER_URL,
                headers={'Authorization': f'Bearer {groq_key}'},
                files={'file': (f'recording{ext}', f, mime)},
                data={
                    'model':            'whisper-large-v3',
                    'response_format':  'verbose_json',
                    'language':         'en',
                },
                timeout=60,
            )
    finally:
        os.unlink(tmp_path)

    if resp.status_code != 200:
        err = resp.json().get('error', {}).get('message', resp.text[:200])
        logger.error(f'Whisper transcription failed: {err}')
        return Response({'error': f'Transcription failed: {err}'}, status=502)

    data       = resp.json()
    transcript = data.get('text', '').strip()
    duration   = data.get('duration', 0)

    if not transcript:
        return Response({'error': 'Could not understand audio. Please try speaking clearly.'}, status=422)

    return Response({
        'transcript':        transcript,
        'duration_seconds':  round(duration, 1),
    })


# ─────────────────────────────────────────────────────────────────────────────
#  Media chat (image / file + optional text message)
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def media_chat(request):
    """
    Send a message with an optional image or file attachment.

    Form fields:
        message         — text message (optional if file is provided)
        file            — image or document (jpg, png, gif, pdf, txt, etc.)
        conversation_id — (optional) continue existing conversation

    Returns same shape as /api/chatbot/chat/ so the frontend can handle
    both endpoints identically.
    """
    groq_key = getattr(settings, 'GROQ_API_KEY', '').strip()
    if not groq_key:
        return Response({'error': 'AI unavailable — GROQ_API_KEY not configured.'}, status=503)

    message         = request.data.get('message', '').strip()
    conversation_id = request.data.get('conversation_id')
    uploaded_file   = request.FILES.get('file')

    if not message and not uploaded_file:
        return Response({'error': 'Provide a message or a file.'}, status=400)

    # ── Process the uploaded file ─────────────────────────────────────────
    file_context = ''
    image_b64    = None
    image_mime   = None

    if uploaded_file:
        mime = uploaded_file.content_type or mimetypes.guess_type(uploaded_file.name)[0] or 'application/octet-stream'

        if mime.startswith('image/'):
            # Image — encode to base64 for vision model
            if uploaded_file.size > MAX_IMAGE_MB * 1024 * 1024:
                return Response({'error': f'Image too large (max {MAX_IMAGE_MB} MB).'}, status=400)
            raw       = uploaded_file.read()
            image_b64 = base64.b64encode(raw).decode('utf-8')
            image_mime = mime

        elif mime in ('text/plain', 'text/csv', 'text/markdown'):
            # Text file — include content directly
            if uploaded_file.size > MAX_FILE_MB * 1024 * 1024:
                return Response({'error': f'File too large (max {MAX_FILE_MB} MB).'}, status=400)
            try:
                content = uploaded_file.read().decode('utf-8', errors='replace')
                file_context = f'\n\n[Attached file: {uploaded_file.name}]\n```\n{content[:4000]}\n```'
            except Exception:
                file_context = f'\n\n[Attached file: {uploaded_file.name} — could not read content]'

        elif mime == 'application/pdf':
            # PDF — extract text with pdfminer if available, else note it
            if uploaded_file.size > MAX_FILE_MB * 1024 * 1024:
                return Response({'error': f'PDF too large (max {MAX_FILE_MB} MB).'}, status=400)
            file_context = _extract_pdf_text(uploaded_file)

        else:
            file_context = f'\n\n[User attached a file: {uploaded_file.name} (type: {mime}) — content not readable]'

    # ── Build the effective message ───────────────────────────────────────
    if not message and image_b64:
        message = 'What do you see in this image? Describe it and give your thoughts.'
    elif not message:
        message = 'Can you help me with this file?'

    full_message = message + file_context

    # ── Call AI ───────────────────────────────────────────────────────────
    if image_b64:
        ai_response, ai_source = _call_vision_ai(
            message, image_b64, image_mime, request.user, groq_key
        )
    else:
        # Use the normal text AI path with file context appended to message
        ai_response, ai_source = _call_ai(full_message, [], request.user)

    # ── Persist to conversation ───────────────────────────────────────────
    # Reuse existing chat persistence — pass the original display message
    # (without raw file data) as the stored user message for readability
    display_message = message if not file_context else f'{message}\n📎 {uploaded_file.name}'

    if _use_firestore():
        return _persist_and_respond_firestore(
            request, display_message, ai_response, ai_source, conversation_id
        )
    return _persist_and_respond_postgres(
        request, display_message, ai_response, ai_source, conversation_id
    )


def _call_vision_ai(message, image_b64, image_mime, user, groq_key):
    """Call Groq vision model with a base64 image."""
    user_context = {
        'username':        user.username,
        'prestige_points': getattr(user, 'prestige_points', None),
        'tier':            getattr(user, 'access_tier', None),
    }
    from .ai_service import _build_system
    system_prompt = _build_system(user_context)

    try:
        resp = http.post(
            GROQ_API_URL,
            headers={
                'Authorization': f'Bearer {groq_key}',
                'Content-Type':  'application/json',
            },
            json={
                'model':    GROQ_VISION_MODEL,
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {
                        'role': 'user',
                        'content': [
                            {
                                'type':      'image_url',
                                'image_url': {
                                    'url': f'data:{image_mime};base64,{image_b64}',
                                },
                            },
                            {'type': 'text', 'text': message},
                        ],
                    },
                ],
                'temperature': 0.7,
                'max_tokens':  800,
            },
            timeout=45,
        )

        if resp.status_code == 200:
            content = resp.json()['choices'][0]['message']['content'].strip()
            return content, 'groq-vision'

        err = resp.json().get('error', {}).get('message', resp.text[:200])
        logger.error(f'Groq vision error: {err}')
        # Fall back to text-only description
        return _call_ai(f'User sent an image and said: {message}', [], user)[0], 'groq'

    except Exception as e:
        logger.error(f'Vision API error: {e}')
        return 'I had trouble analysing the image. Please try again.', 'fallback'


def _extract_pdf_text(pdf_file) -> str:
    """Extract text from a PDF file using pdfminer if available."""
    try:
        from pdfminer.high_level import extract_text as pdf_extract
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
            for chunk in pdf_file.chunks():
                tmp.write(chunk)
            tmp_path = tmp.name
        try:
            text = pdf_extract(tmp_path)
            text = text[:4000].strip()
            return f'\n\n[Attached PDF: {pdf_file.name}]\n```\n{text}\n```'
        finally:
            os.unlink(tmp_path)
    except ImportError:
        return f'\n\n[Attached PDF: {pdf_file.name} — install pdfminer.six to enable PDF reading]'
    except Exception as e:
        return f'\n\n[Attached PDF: {pdf_file.name} — could not extract text: {e}]'


def _persist_and_respond_postgres(request, user_msg_text, ai_response, ai_source, conversation_id):
    from django.shortcuts import get_object_or_404
    from .models import ChatConversation, ChatMessage
    from .serializers import ChatMessageSerializer

    user = request.user

    if conversation_id:
        try:
            conversation = get_object_or_404(ChatConversation, id=int(conversation_id), user=user)
        except (ValueError, TypeError):
            conversation = ChatConversation.objects.create(user=user, title=user_msg_text[:50])
    else:
        conversation = ChatConversation.objects.create(user=user, title=user_msg_text[:50])

    user_message = ChatMessage.objects.create(conversation=conversation, role='user',      content=user_msg_text)
    ai_message   = ChatMessage.objects.create(conversation=conversation, role='assistant', content=ai_response)

    return Response({
        'conversation_id': conversation.id,
        'user_message':    ChatMessageSerializer(user_message).data,
        'ai_message':      ChatMessageSerializer(ai_message).data,
        'ai_source':       ai_source,
    })


def _persist_and_respond_firestore(request, user_msg_text, ai_response, ai_source, conversation_id):
    from .firestore_chat_service import (
        create_conversation, get_conversation, save_message
    )
    user = request.user

    if conversation_id:
        conv = get_conversation(user, conversation_id)
    else:
        conv = None

    if conv is None:
        conv            = create_conversation(user, title=user_msg_text[:50])
        conversation_id = conv['id'] if conv else None

    user_msg = save_message(user, conversation_id, role='user',      content=user_msg_text)
    ai_msg   = save_message(user, conversation_id, role='assistant', content=ai_response)

    return Response({
        'conversation_id': conversation_id,
        'user_message':    user_msg,
        'ai_message':      ai_msg,
        'ai_source':       ai_source,
    })
