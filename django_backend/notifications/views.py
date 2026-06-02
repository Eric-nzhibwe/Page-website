"""
Notification views for ARTX Platform
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .tasks import send_tier_upgrade_email, send_alliance_join_email
from .models import InAppNotification


# ─────────────────────────────────────────────────────────────────────────────
#  IN-APP NOTIFICATION HELPERS  (called from consumers / views)
# ─────────────────────────────────────────────────────────────────────────────
def create_notification(recipient, notif_type, title, message, actor=None, link=''):
    """Create an in-app notification.  Safe to call from sync or async context."""
    if recipient == actor:
        return None  # never notify yourself
    return InAppNotification.objects.create(
        recipient=recipient,
        actor=actor,
        notif_type=notif_type,
        title=title,
        message=message,
        link=link,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  IN-APP NOTIFICATION REST ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    """Return the 50 most recent in-app notifications for the current user."""
    notifs = InAppNotification.objects.filter(
        recipient=request.user
    ).select_related('actor')[:50]

    data = [
        {
            'id':         n.id,
            'type':       n.notif_type,
            'title':      n.title,
            'message':    n.message,
            'link':       n.link,
            'is_read':    n.is_read,
            'created_at': n.created_at.isoformat(),
            'actor': {
                'username':     n.actor.username,
                'display_name': n.actor.display_name or n.actor.username,
                'profile_image': n.actor.profile_image.url if n.actor and n.actor.profile_image else None,
            } if n.actor else None,
        }
        for n in notifs
    ]
    unread_count = sum(1 for n in data if not n['is_read'])
    return Response({'notifications': data, 'unread_count': unread_count})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mark_notifications_read(request):
    """Mark all (or specific) notifications as read."""
    ids = request.data.get('ids')  # optional list of ids; omit for all
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
        # TODO: Get user notification preferences
        return Response({'preferences': {}}, status=status.HTTP_200_OK)
    else:
        # TODO: Update user notification preferences
        return Response({'message': 'Preferences updated'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def notification_history(request):
    """Get notification history"""
    # TODO: Implement notification history
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
        
        # Send tier upgrade email
        send_tier_upgrade_email(request.user.id, old_tier, new_tier)
        
        return Response({
            'message': f'Tier upgrade email sent for {old_tier} -> {new_tier}',
            'success': True
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response(
            {'error': str(e)}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


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
        
        # For now, we'll create a mock alliance or use alliance ID 1
        # In a real implementation, you'd look up the alliance by name
        alliance_id = 1  # Mock alliance ID
        
        # Send alliance join email
        send_alliance_join_email(request.user.id, alliance_id)
        
        return Response({
            'message': f'Alliance join email sent for {alliance_name}',
            'success': True
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        return Response(
            {'error': str(e)}, 
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )