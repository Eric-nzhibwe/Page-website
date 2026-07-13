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

from channels.generic.websocket import AsyncWebsocketConsumer

logger = logging.getLogger(__name__)


class ChallengeConsumer(AsyncWebsocketConsumer):
    """
    One group per challenge: "challenge_<uuid>"
    All subscribers receive the same broadcast messages.
    """

    async def connect(self):
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
