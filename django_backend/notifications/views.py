"""
Notification views for ARTX Platform
"""
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .tasks import send_tier_upgrade_email, send_alliance_join_email
from .models import InAppNotification

# Convenience flag — checked once per request, not per import
def _use_firestore():
    return settings.FIRESTORE_COLLECTIONS.get('notifications', False)


# ─────────────────────────────────────────────────────────────────────────────
#  IN-APP NOTIFICATION HELPERS  (called from consumers / views)
# ─────────────────────────────────────────────────────────────────────────────
def create_notification(recipient, notif_type, title, message, actor=None, link=''):
    """
    Create an in-app notification and push it to the recipient's WebSocket.
    Routes to Firestore or PostgreSQL based on the feature flag.
    """
    if recipient == actor:
        return None  # never notify yourself

    if _use_firestore():
        from .firestore_service import create_notification as fs_create
        notif = fs_create(recipient, notif_type, title, message, actor=actor, link=link)
        # Still push to WebSocket even with Firestore storage
        if notif:
            _push_websocket(recipient, notif)
        return notif
    else:
        notif = InAppNotification.objects.create(
            recipient=recipient,
            actor=actor,
            notif_type=notif_type,
            title=title,
            message=message,
            link=link,
        )
        _push_websocket(recipient, _serialize_pg_notif(notif))
        return notif


def _push_websocket(recipient, serialized_notif):
    """Push a notification dict to the recipient's live WebSocket (best-effort)."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from notifications.consumers import user_group

        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                user_group(recipient.id),
                {
                    'type':         'notify_new',
                    'notification': serialized_notif,
                }
            )
    except Exception:
        pass  # Never let a push failure break the calling request


def _serialize_pg_notif(n):
    """Serialize a PostgreSQL InAppNotification instance to a plain dict."""
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
            'profile_image': n.actor.profile_image.url if n.actor and n.actor.profile_image else None,
        } if n.actor else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
#  IN-APP NOTIFICATION REST ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    """Return the 50 most recent in-app notifications for the current user."""
    if _use_firestore():
        from .firestore_service import list_notifications as fs_list, unread_count as fs_unread
        data         = fs_list(request.user, limit=50)
        unread       = sum(1 for n in data if not n['is_read'])
    else:
        notifs = InAppNotification.objects.filter(
            recipient=request.user
        ).select_related('actor')[:50]
        data   = [_serialize_pg_notif(n) for n in notifs]
        unread = sum(1 for n in data if not n['is_read'])

    return Response({'notifications': data, 'unread_count': unread})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notifications_read(request):
    """Mark all (or specific) notifications as read."""
    ids = request.data.get('ids')  # optional list of ids; omit for all

    if _use_firestore():
        from .firestore_service import mark_read as fs_mark
        updated = fs_mark(request.user, ids=ids)
    else:
        qs = InAppNotification.objects.filter(recipient=request.user, is_read=False)
        if ids:
            qs = qs.filter(id__in=ids)
        updated = qs.update(is_read=True)

    return Response({'marked_read': updated})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_email_notification(request):
    """Send email notification"""
    # TODO: Implement email sending logic
    return Response({'message': 'Email notification sent'}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_sms_notification(request):
    """Send SMS notification"""
    # TODO: Implement SMS sending logic
    return Response({'message': 'SMS notification sent'}, status=status.HTTP_200_OK)


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def notification_preferences(request):
    """Get or update notification preferences"""
    if request.method == 'GET':
        return Response({'preferences': {}}, status=status.HTTP_200_OK)
    else:
        return Response({'message': 'Preferences updated'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_history(request):
    """Get notification history"""
    return Response({'notifications': []}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def tier_upgrade_notification(request):
    """Send tier upgrade email notification"""
    try:
        old_tier = request.data.get('old_tier')
        new_tier = request.data.get('new_tier')

        if not old_tier or not new_tier:
            return Response(
                {'error': 'old_tier and new_tier are required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        send_tier_upgrade_email(request.user.id, old_tier, new_tier)

        return Response({
            'message': f'Tier upgrade email sent for {old_tier} -> {new_tier}',
            'success': True
        }, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def alliance_join_notification(request):
    """Send alliance join email notification"""
    try:
        alliance_name = request.data.get('alliance_name')

        if not alliance_name:
            return Response(
                {'error': 'alliance_name is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        alliance_id = 1  # placeholder — real implementation looks up by name
        send_alliance_join_email(request.user.id, alliance_id)

        return Response({
            'message': f'Alliance join email sent for {alliance_name}',
            'success': True
        }, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
