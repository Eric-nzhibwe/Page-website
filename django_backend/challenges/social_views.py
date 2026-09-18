"""
Social Challenge API Views — Polls, Debates, Q&A, XPoints
==========================================================
Endpoints used exclusively by index.html real-time features.
All writes deduct/earn xPoints and persist to the database.
"""
import logging
from django.utils import timezone
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from .models import (
    PollChallenge, PollVote,
    DebateChallenge, DebateParticipant, DebateComment,
    QAChallenge, QAAnswer,
    XPointsLedger, XPOINTS_ENTRY_COST, XPOINTS_EARN,
)

logger = logging.getLogger(__name__)
channel_layer = get_channel_layer()


# ─────────────────────────────────────────────────────────────────────────────
#  xPoints
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def xpoints_balance(request):
    """Return the current user's xP balance."""
    ledger = XPointsLedger.get_or_create_for(request.user)
    return Response({'balance': ledger.balance})


# ─────────────────────────────────────────────────────────────────────────────
#  Polls
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([AllowAny])
def poll_list(request):
    """List all active polls with vote counts."""
    polls = PollChallenge.objects.filter(is_active=True).select_related('created_by')
    user_voted = set()
    if request.user.is_authenticated:
        user_voted = set(
            PollVote.objects.filter(user=request.user)
            .values_list('poll_id', flat=True)
        )

    data = []
    for p in polls:
        counts = p.vote_counts()
        total  = p.total_votes()
        data.append({
            'id':           str(p.id),
            'title':        p.title,
            'options':      p.options,
            'prize_amount': str(p.prize_amount),
            'difficulty':   p.difficulty,
            'duration_days': p.duration_days,
            'created_by':   p.created_by.username,
            'created_at':   p.created_at.isoformat(),
            'total_votes':  total,
            'vote_counts':  counts,
            'user_voted':   str(p.id) in [str(v) for v in user_voted],
        })
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_poll(request):
    """Create a new poll challenge."""
    data   = request.data
    title  = data.get('title', '').strip()
    options = data.get('options', [])

    if not title:
        return Response({'error': 'Title is required.'}, status=400)
    if len(options) < 2:
        return Response({'error': 'At least 2 options required.'}, status=400)

    poll = PollChallenge.objects.create(
        created_by   = request.user,
        title        = title,
        description  = data.get('description', ''),
        prize_amount = data.get('prize_amount', 0),
        difficulty   = data.get('difficulty', 'easy'),
        duration_days = data.get('duration_days', 7),
        options      = options[:4],
    )
    return Response({'id': str(poll.id), 'title': poll.title}, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def cast_poll_vote(request, poll_id):
    """
    Cast a vote on a poll. Costs XPOINTS_ENTRY_COST xP.
    Returns updated vote counts so the UI can animate immediately.
    """
    option_index = request.data.get('option_index')
    if option_index is None:
        return Response({'error': 'option_index is required.'}, status=400)

    try:
        poll = PollChallenge.objects.get(id=poll_id, is_active=True)
    except PollChallenge.DoesNotExist:
        return Response({'error': 'Poll not found.'}, status=404)

    if PollVote.objects.filter(poll=poll, user=request.user).exists():
        return Response({'error': 'Already voted.'}, status=400)

    # Deduct xPoints
    ledger = XPointsLedger.get_or_create_for(request.user)
    if not ledger.spend(XPOINTS_ENTRY_COST):
        return Response({'error': f'Insufficient xPoints. Need {XPOINTS_ENTRY_COST} xP.'}, status=402)

    with transaction.atomic():
        PollVote.objects.create(poll=poll, user=request.user, option_index=int(option_index))
        ledger.earn(XPOINTS_EARN)   # reward for participating

    counts = poll.vote_counts()
    total  = poll.total_votes()
    return Response({
        'voted':       True,
        'balance':     ledger.balance,
        'vote_counts': counts,
        'total_votes': total,
    })


# ─────────────────────────────────────────────────────────────────────────────
#  Debates
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([AllowAny])
def debate_list(request):
    """List all active debates with participant counts and recent comments."""
    debates = DebateChallenge.objects.filter(is_active=True).select_related('created_by')
    user_joined = set()
    if request.user.is_authenticated:
        user_joined = set(
            DebateParticipant.objects.filter(user=request.user)
            .values_list('debate_id', flat=True)
        )

    data = []
    for d in debates:
        counts   = d.participant_counts()
        comments = list(
            d.comments.select_related('user')
            .order_by('-created_at')[:20]
        )
        data.append({
            'id':           str(d.id),
            'title':        d.title,
            'description':  d.description,
            'image_url':    d.image_url,
            'side_a':       d.side_a,
            'side_b':       d.side_b,
            'prize_amount': str(d.prize_amount),
            'difficulty':   d.difficulty,
            'duration_days': d.duration_days,
            'created_by':   d.created_by.username,
            'created_at':   d.created_at.isoformat(),
            'participants': counts,
            'user_joined':  str(d.id) in [str(v) for v in user_joined],
            'comments': [
                {
                    'user':       c.user.username,
                    'text':       c.text,
                    'created_at': c.created_at.isoformat(),
                }
                for c in reversed(comments)
            ],
        })
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_debate(request):
    """Create a new debate challenge."""
    data  = request.data
    title = data.get('title', '').strip()
    side_a = data.get('side_a', '').strip()
    side_b = data.get('side_b', '').strip()

    if not all([title, side_a, side_b]):
        return Response({'error': 'title, side_a, and side_b are required.'}, status=400)

    debate = DebateChallenge.objects.create(
        created_by   = request.user,
        title        = title,
        description  = data.get('description', ''),
        image_url    = data.get('image_url', ''),
        side_a       = side_a,
        side_b       = side_b,
        prize_amount = data.get('prize_amount', 0),
        difficulty   = data.get('difficulty', 'medium'),
        duration_days = data.get('duration_days', 7),
    )
    return Response({'id': str(debate.id), 'title': debate.title}, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def join_debate(request, debate_id):
    """
    Join a debate side. Costs XPOINTS_ENTRY_COST xP.
    """
    side = request.data.get('side', '').lower()
    if side not in ('a', 'b'):
        return Response({'error': 'side must be "a" or "b".'}, status=400)

    try:
        debate = DebateChallenge.objects.get(id=debate_id, is_active=True)
    except DebateChallenge.DoesNotExist:
        return Response({'error': 'Debate not found.'}, status=404)

    if DebateParticipant.objects.filter(debate=debate, user=request.user).exists():
        return Response({'error': 'Already joined.'}, status=400)

    ledger = XPointsLedger.get_or_create_for(request.user)
    if not ledger.spend(XPOINTS_ENTRY_COST):
        return Response({'error': f'Insufficient xPoints. Need {XPOINTS_ENTRY_COST} xP.'}, status=402)

    with transaction.atomic():
        DebateParticipant.objects.create(debate=debate, user=request.user, side=side)
        ledger.earn(XPOINTS_EARN)

    counts = debate.participant_counts()
    return Response({
        'joined':       True,
        'side':         side,
        'balance':      ledger.balance,
        'participants': counts,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def post_debate_comment(request, debate_id):
    """
    Post a live comment on a debate.
    Costs XPOINTS_ENTRY_COST xP on first comment; free after joining.
    Broadcasts via WebSocket so all connected clients see it instantly.
    """
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required.'}, status=400)
    if len(text) > 500:
        return Response({'error': 'Comment too long (max 500 chars).'}, status=400)

    try:
        debate = DebateChallenge.objects.get(id=debate_id, is_active=True)
    except DebateChallenge.DoesNotExist:
        return Response({'error': 'Debate not found.'}, status=404)

    # Check if already a participant; if not, charge entry
    is_participant = DebateParticipant.objects.filter(debate=debate, user=request.user).exists()
    ledger = XPointsLedger.get_or_create_for(request.user)

    if not is_participant:
        if not ledger.spend(XPOINTS_ENTRY_COST):
            return Response({'error': f'Need {XPOINTS_ENTRY_COST} xP to comment.'}, status=402)
        DebateParticipant.objects.get_or_create(debate=debate, user=request.user, defaults={'side': 'a'})
        ledger.earn(XPOINTS_EARN)

    comment = DebateComment.objects.create(debate=debate, user=request.user, text=text)

    # Broadcast via WebSocket to debate group
    payload = {
        'user':       request.user.username,
        'text':       text,
        'created_at': comment.created_at.isoformat(),
    }
    _broadcast_debate(str(debate_id), payload)

    return Response({
        'id':         str(comment.id),
        'user':       request.user.username,
        'text':       text,
        'created_at': comment.created_at.isoformat(),
        'balance':    ledger.balance,
    }, status=201)


def _broadcast_debate(debate_id: str, payload: dict):
    """Send a comment to all WebSocket listeners on this debate."""
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            f'debate_{debate_id}',
            {'type': 'debate_comment', 'payload': payload},
        )
    except Exception as exc:
        logger.warning(f'Debate WS broadcast failed: {exc}')


# ─────────────────────────────────────────────────────────────────────────────
#  Q&A
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([AllowAny])
def qa_list(request):
    """List all active Q&A challenges with latest answers."""
    qas = QAChallenge.objects.filter(is_active=True).select_related('created_by')
    data = []
    for q in qas:
        answers = list(q.answers.select_related('user').order_by('-created_at')[:20])
        data.append({
            'id':           str(q.id),
            'title':        q.title,
            'description':  q.description,
            'image_url':    q.image_url,
            'prize_amount': str(q.prize_amount),
            'difficulty':   q.difficulty,
            'duration_days': q.duration_days,
            'created_by':   q.created_by.username,
            'created_at':   q.created_at.isoformat(),
            'answers': [
                {
                    'user':       a.user.username,
                    'text':       a.text,
                    'created_at': a.created_at.isoformat(),
                }
                for a in reversed(answers)
            ],
        })
    return Response(data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_qa(request):
    """Create a new Q&A challenge."""
    data  = request.data
    title = data.get('title', '').strip()
    if not title:
        return Response({'error': 'title is required.'}, status=400)

    qa = QAChallenge.objects.create(
        created_by   = request.user,
        title        = title,
        description  = data.get('description', ''),
        image_url    = data.get('image_url', ''),
        prize_amount = data.get('prize_amount', 0),
        difficulty   = data.get('difficulty', 'easy'),
        duration_days = data.get('duration_days', 7),
    )
    return Response({'id': str(qa.id), 'title': qa.title}, status=201)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def post_qa_answer(request, qa_id):
    """
    Post an answer to a Q&A challenge. Costs XPOINTS_ENTRY_COST xP.
    Broadcasts via WebSocket so all viewers see it instantly.
    """
    text = request.data.get('text', '').strip()
    if not text:
        return Response({'error': 'text is required.'}, status=400)
    if len(text) > 1000:
        return Response({'error': 'Answer too long (max 1000 chars).'}, status=400)

    try:
        qa = QAChallenge.objects.get(id=qa_id, is_active=True)
    except QAChallenge.DoesNotExist:
        return Response({'error': 'Q&A not found.'}, status=404)

    ledger = XPointsLedger.get_or_create_for(request.user)
    if not ledger.spend(XPOINTS_ENTRY_COST):
        return Response({'error': f'Need {XPOINTS_ENTRY_COST} xP to answer.'}, status=402)

    answer = QAAnswer.objects.create(qa=qa, user=request.user, text=text)
    ledger.earn(XPOINTS_EARN)

    # Broadcast via WebSocket
    payload = {
        'user':       request.user.username,
        'text':       text,
        'created_at': answer.created_at.isoformat(),
    }
    _broadcast_qa(str(qa_id), payload)

    return Response({
        'id':         str(answer.id),
        'user':       request.user.username,
        'text':       text,
        'created_at': answer.created_at.isoformat(),
        'balance':    ledger.balance,
    }, status=201)


def _broadcast_qa(qa_id: str, payload: dict):
    """Send an answer to all WebSocket listeners on this Q&A."""
    if channel_layer is None:
        return
    try:
        async_to_sync(channel_layer.group_send)(
            f'qa_{qa_id}',
            {'type': 'qa_answer', 'payload': payload},
        )
    except Exception as exc:
        logger.warning(f'QA WS broadcast failed: {exc}')
