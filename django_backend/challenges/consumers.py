"""
WebSocket consumer for real-time challenge updates.

Clients connect to:  ws://<host>/ws/challenges/<challenge_id>/

Messages the server sends (JSON):
  { "type": "challenge.update",  "payload": { ... } }
  { "type": "new_submission",    "payload": { ... } }
  { "type": "leaderboard_update","payload": { ... } }
  { "type": "activity",          "payload": { ... } }

Clients may send:
  { "action": "ping" }   →  server echoes { "type": "pong" }
"""
import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


# ── shared auth helpers (same pattern as social/consumers.py) ────────────────

@database_sync_to_async
def _get_user_from_token(token_key):
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
    qs = scope.get('query_string', b'').decode()
    for part in qs.split('&'):
        if part.startswith('token='):
            return part.split('=', 1)[1]
    return None


class ChallengeConsumer(AsyncWebsocketConsumer):
    """
    One group per challenge: "challenge_<uuid>"
    All subscribers receive the same broadcast messages.
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.challenge_id = self.scope["url_route"]["kwargs"]["challenge_id"]
        self.group_name = f"challenge_{self.challenge_id}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.debug("WS connected: %s → group %s", self.channel_name, self.group_name)

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.debug("WS disconnected: %s (code %s)", self.channel_name, close_code)
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return

        if data.get("action") == "ping":
            await self.send(text_data=json.dumps({"type": "pong"}))

    # ── Handlers for messages sent via channel_layer.group_send ──────────

    async def challenge_update(self, event):
        await self.send(text_data=json.dumps({
            "type":    "challenge.update",
            "payload": event.get("payload", {}),
        }))

    async def new_submission(self, event):
        await self.send(text_data=json.dumps({
            "type":    "new_submission",
            "payload": event.get("payload", {}),
        }))

    async def leaderboard_update(self, event):
        await self.send(text_data=json.dumps({
            "type":    "leaderboard_update",
            "payload": event.get("payload", {}),
        }))

    async def activity(self, event):
        await self.send(text_data=json.dumps({
            "type":    "activity",
            "payload": event.get("payload", {}),
        }))


class DebateConsumer(AsyncWebsocketConsumer):
    """
    Real-time comment stream for a debate.
    ws://<host>/ws/debate/<debate_id>/
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.debate_id  = self.scope['url_route']['kwargs']['debate_id']
        self.group_name = f'debate_{self.debate_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        if data.get('action') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def debate_comment(self, event):
        await self.send(text_data=json.dumps({
            'type':    'debate_comment',
            'payload': event.get('payload', {}),
        }))


class QAConsumer(AsyncWebsocketConsumer):
    """
    Real-time answer stream for a Q&A challenge.
    ws://<host>/ws/qa/<qa_id>/
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.qa_id      = self.scope['url_route']['kwargs']['qa_id']
        self.group_name = f'qa_{self.qa_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        if data.get('action') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def qa_answer(self, event):
        await self.send(text_data=json.dumps({
            'type':    'qa_answer',
            'payload': event.get('payload', {}),
        }))


class PollConsumer(AsyncWebsocketConsumer):
    """
    Real-time vote-count stream for a poll challenge.
    ws://<host>/ws/poll/<poll_id>/

    Server sends:
      { "type": "poll_vote", "payload": { "poll_id": "...", "vote_counts": {...}, "total_votes": N } }
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.poll_id    = self.scope['url_route']['kwargs']['poll_id']
        self.group_name = f'poll_{self.poll_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (json.JSONDecodeError, TypeError):
            return
        if data.get('action') == 'ping':
            await self.send(text_data=json.dumps({'type': 'pong'}))

    async def poll_vote(self, event):
        await self.send(text_data=json.dumps({
            'type':    'poll_vote',
            'payload': event.get('payload', {}),
        }))
