"""
WebSocket consumer for real-time in-app notifications.

Each authenticated user connects to their own private channel:
  ws://host/ws/notifications/?token=<DRF auth token>

When create_notification() saves a new notification it pushes to the
user's personal group  'notifications_<user_id>'  and this consumer
forwards it to the browser immediately.
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.serializers.json import DjangoJSONEncoder


# ── shared helpers (same pattern as social/consumers.py) ────────────────────

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


def user_group(user_id):
    """Channel group name for a specific user's notifications."""
    return f'notifications_{user_id}'


# ── Consumer ─────────────────────────────────────────────────────────────────

class NotificationConsumer(AsyncWebsocketConsumer):
    """
    Private per-user notification channel.
    Authenticated via ?token= query param (same as social consumers).
    """

    async def connect(self):
        token_key = _token_from_scope(self.scope)
        self.user, err = await _get_user_from_token(token_key)
        if err:
            await self.close(code=4001)
            return

        self.group_name = user_group(self.user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send unread count + last 20 notifications immediately on connect
        snapshot = await self._get_snapshot()
        await self.send(text_data=_send({
            'type':         'notifications_snapshot',
            'notifications': snapshot['notifications'],
            'unread_count':  snapshot['unread_count'],
        }))

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """Handle messages from the client."""
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        action = data.get('action')

        if action == 'ping':
            await self.send(text_data=_send({'type': 'pong'}))

        elif action == 'mark_read':
            ids = data.get('ids')   # list of ids, or omit for all
            count = await self._mark_read(ids)
            await self.send(text_data=_send({
                'type':        'marked_read',
                'marked_count': count,
            }))

    # ── group message handler — called by create_notification() ──────────────

    async def notify_new(self, event):
        """Receive a new-notification push from the channel layer and forward it."""
        await self.send(text_data=_send({
            'type':         'new_notification',
            'notification': event['notification'],
        }))

    # ── DB helpers ────────────────────────────────────────────────────────────

    @database_sync_to_async
    def _get_snapshot(self):
        from .models import InAppNotification
        notifs = InAppNotification.objects.filter(
            recipient=self.user
        ).select_related('actor').order_by('-created_at')[:20]

        data = [_serialize_notif(n) for n in notifs]
        return {
            'notifications': data,
            'unread_count':  sum(1 for n in data if not n['is_read']),
        }

    @database_sync_to_async
    def _mark_read(self, ids=None):
        from .models import InAppNotification
        qs = InAppNotification.objects.filter(recipient=self.user, is_read=False)
        if ids:
            qs = qs.filter(id__in=ids)
        return qs.update(is_read=True)


# ── Serializer helper ─────────────────────────────────────────────────────────

def _serialize_notif(n):
    return {
        'id':         n.id,
        'type':       n.notif_type,
        'title':      n.title,
        'message':    n.message,
        'link':       n.link,
        'is_read':    n.is_read,
        'created_at': n.created_at.isoformat(),
        'actor': {
            'username':      n.actor.username,
            'display_name':  n.actor.display_name or n.actor.username,
            'profile_image': n.actor.profile_image.url if n.actor.profile_image else None,
        } if n.actor else None,
    }
