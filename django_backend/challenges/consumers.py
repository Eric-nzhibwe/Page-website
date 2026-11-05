"""
WebSocket consumer for real-time challenge updates.

Clients connect to:  ws://<host>/ws/challenges/<challenge_id>/
  ?token=<DRF auth token>  OR  ?token=fb:<Firebase ID token>

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

# Shared auth helper — supports both DRF tokens and Firebase ID tokens
from page_platform.ws_auth import get_user_from_token as _get_user_from_token
from page_platform.ws_auth import _token_from_scope

logger = logging.getLogger(__name__)


class ChallengeConsumer(AsyncWebsocketConsumer):
    """
    One group per challenge: "challenge_<uuid>"
    All subscribers receive the same broadcast messages.
    """

    async def connect(self):
        # Set group_name early so disconnect() is always safe
        challenge_id = self.scope["url_route"]["kwargs"].get("challenge_id", "unknown")
        self.group_name = f"challenge_{challenge_id}"

        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.challenge_id = challenge_id
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.debug("WS connected: %s → group %s", self.channel_name, self.group_name)

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
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
        # Set group_name early so disconnect() is always safe
        debate_id = self.scope['url_route']['kwargs'].get('debate_id', 'unknown')
        self.group_name = f'debate_{debate_id}'

        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.debate_id = debate_id
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
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
        # Set group_name early so disconnect() is always safe even on auth failure
        qa_id = self.scope['url_route']['kwargs'].get('qa_id', 'unknown')
        self.group_name = f'qa_{qa_id}'

        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.qa_id = qa_id
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
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
        # Set group_name early so disconnect() is always safe even on auth failure
        poll_id = self.scope['url_route']['kwargs'].get('poll_id', 'unknown')
        self.group_name = f'poll_{poll_id}'

        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.poll_id = poll_id
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
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
