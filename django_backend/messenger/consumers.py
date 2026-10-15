"""
WebSocket consumer for real-time messaging.

Each user connects to their own personal channel:
  ws://host/ws/messenger/?token=<DRF auth token>

When a message is sent via the REST API (send_message view), the view
calls _broadcast_message() which pushes to both participants' groups:
  conversation_<conversation_id>

This consumer also handles typing indicators and read receipts.
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.serializers.json import DjangoJSONEncoder


# ── shared auth helper ───────────────────────────────────────────────────────

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


def _send(payload):
    return json.dumps(payload, cls=DjangoJSONEncoder)


def conversation_group(conversation_id):
    """Channel group name for a conversation."""
    return f'conversation_{conversation_id}'


# ── Consumer ─────────────────────────────────────────────────────────────────

class MessengerConsumer(AsyncWebsocketConsumer):
    """
    Per-user messenger channel.
    On connect the user joins groups for all their active conversations
    so they receive new messages from any conversation in real time.
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        # Join a group per conversation the user participates in
        self.conversation_groups = await self._get_conversation_groups()
        for group in self.conversation_groups:
            await self.channel_layer.group_add(group, self.channel_name)

        await self.accept()

        # Send unread count on connect
        unread = await self._get_unread_count()
        await self.send(text_data=_send({
            'type':         'messenger_ready',
            'unread_count': unread,
        }))

    async def disconnect(self, close_code):
        for group in getattr(self, 'conversation_groups', []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        action = data.get('action')

        if action == 'ping':
            await self.send(text_data=_send({'type': 'pong'}))

        elif action == 'typing':
            # Broadcast typing indicator to the other participant
            conv_id = data.get('conversation_id')
            if conv_id:
                await self.channel_layer.group_send(
                    conversation_group(conv_id),
                    {
                        'type':            'ws_typing',
                        'conversation_id': conv_id,
                        'user_id':         self.user.id,
                        'username':        self.user.username,
                        'is_typing':       bool(data.get('is_typing', False)),
                    }
                )

        elif action == 'mark_read':
            conv_id = data.get('conversation_id')
            if conv_id:
                count = await self._mark_read(conv_id)
                await self.send(text_data=_send({
                    'type':            'marked_read',
                    'conversation_id': conv_id,
                    'marked_count':    count,
                }))

    # ── group message handlers ────────────────────────────────────────────────

    async def ws_new_message(self, event):
        """A new message was sent in one of this user's conversations."""
        await self.send(text_data=_send({
            'type':    'new_message',
            'message': event['message'],
        }))

    async def ws_typing(self, event):
        """Another participant is typing (or stopped typing)."""
        # Don't echo back to the sender
        if event['user_id'] == self.user.id:
            return
        await self.send(text_data=_send({
            'type':            'typing',
            'conversation_id': event['conversation_id'],
            'user_id':         event['user_id'],
            'username':        event['username'],
            'is_typing':       event['is_typing'],
        }))

    # ── DB helpers ────────────────────────────────────────────────────────────

    @database_sync_to_async
    def _get_conversation_groups(self):
        from .models import Conversation
        ids = Conversation.objects.filter(
            participants=self.user
        ).values_list('id', flat=True)
        return [conversation_group(cid) for cid in ids]

    @database_sync_to_async
    def _get_unread_count(self):
        from .models import Message
        return Message.objects.filter(
            conversation__participants=self.user,
            read=False,
        ).exclude(sender=self.user).count()

    @database_sync_to_async
    def _mark_read(self, conversation_id):
        from .models import Conversation, Message
        try:
            conv = Conversation.objects.get(id=conversation_id, participants=self.user)
        except Conversation.DoesNotExist:
            return 0
        return (Message.objects
                .filter(conversation=conv, read=False)
                .exclude(sender=self.user)
                .update(read=True))
