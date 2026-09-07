"""
Alliance views for ARTX Platform — Firestore-backed
"""
from django.conf import settings
from rest_framework import generics
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status


def _use_fs():
    """True when FS_ALLIANCES flag is on OR alliances were never implemented in PG."""
    # Alliances views were always TODO stubs — use Firestore whenever it's available.
    from artx_platform.firebase_client import firebase_enabled
    return (
        settings.FIRESTORE_COLLECTIONS.get('alliances', False)
        or firebase_enabled()
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Alliance list & detail
# ─────────────────────────────────────────────────────────────────────────────

class AllianceListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if _use_fs():
            from .firestore_alliance_service import list_alliances
            alliances = list_alliances(public_only=True)
            return Response({'alliances': alliances})
        return Response({'alliances': []})


class AllianceDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        if _use_fs():
            from .firestore_alliance_service import get_alliance
            alliance = get_alliance(pk)
            if alliance is None:
                return Response({'error': 'Alliance not found.'},
                                status=status.HTTP_404_NOT_FOUND)
            return Response({'alliance': alliance})
        return Response({'alliance': {}})


# ─────────────────────────────────────────────────────────────────────────────
#  Members & Events
# ─────────────────────────────────────────────────────────────────────────────

class AllianceMembersView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, alliance_id):
        if _use_fs():
            from .firestore_alliance_service import get_members
            return Response({'members': get_members(alliance_id)})
        return Response({'members': []})


class AllianceEventsView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, alliance_id):
        if _use_fs():
            from .firestore_alliance_service import get_events
            return Response({'events': get_events(alliance_id)})
        return Response({'events': []})


# ─────────────────────────────────────────────────────────────────────────────
#  Create alliance
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_alliance_view(request):
    """Create a new alliance.  The requesting user becomes the leader."""
    if not _use_fs():
        return Response({'error': 'Alliance creation is not available yet.'},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)

    name        = (request.data.get('name') or '').strip()
    tag         = (request.data.get('tag') or '').strip()
    description = (request.data.get('description') or '').strip()
    is_public   = request.data.get('is_public', True)
    req_approval = request.data.get('requires_approval', False)
    min_tier    = request.data.get('min_tier', 'Bronze')
    max_members = int(request.data.get('max_members', 50))

    if not name:
        return Response({'error': 'name is required.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if not tag:
        return Response({'error': 'tag is required.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if len(tag) > 10:
        return Response({'error': 'tag must be 10 characters or fewer.'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Handle logo upload
    logo_url = None
    logo_file = request.FILES.get('logo')
    if logo_file:
        import os
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        ext       = os.path.splitext(logo_file.name)[1].lower()
        safe_name = f"alliance_logos/{tag.upper()}_{tag}{ext}"
        path      = default_storage.save(safe_name, ContentFile(logo_file.read()))
        logo_url  = request.build_absolute_uri(default_storage.url(path))

    from .firestore_alliance_service import create_alliance
    try:
        alliance = create_alliance(
            leader=request.user,
            name=name, tag=tag, description=description,
            logo_url=logo_url,
            is_public=is_public, requires_approval=req_approval,
            min_tier=min_tier, max_members=max_members,
        )
        # Send alliance created email notification
        try:
            from notifications.tasks import send_alliance_join_email
            send_alliance_join_email(request.user.id, alliance['id'])
        except Exception:
            pass
        return Response({'alliance': alliance, 'message': 'Alliance created!'},
                        status=status.HTTP_201_CREATED)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as exc:
        return Response({'error': 'Could not create alliance. Please try again.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
#  Join / Leave
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def join_alliance_view(request, alliance_id):
    """Join an alliance directly (or submit request if approval required)."""
    if not _use_fs():
        return Response({'message': 'Joined alliance'})

    from .firestore_alliance_service import join_alliance
    try:
        membership = join_alliance(str(alliance_id), request.user)
        return Response({
            'message': ('Join request submitted.'
                        if membership.get('status') == 'pending'
                        else 'Joined alliance!'),
            'membership': membership,
        })
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        return Response({'error': 'Could not join alliance. Please try again.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def leave_alliance_view(request, alliance_id):
    """Leave an alliance."""
    if not _use_fs():
        return Response({'message': 'Left alliance'})

    from .firestore_alliance_service import leave_alliance
    ok = leave_alliance(str(alliance_id), request.user)
    if ok:
        return Response({'message': 'You have left the alliance.'})
    return Response({'error': 'You are not a member of this alliance.'},
                    status=status.HTTP_404_NOT_FOUND)


# ─────────────────────────────────────────────────────────────────────────────
#  Invitations
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def invite_to_alliance_view(request, alliance_id):
    """Invite a user to the alliance (leader/officer only)."""
    if not _use_fs():
        return Response({'message': 'Invitation sent'})

    from users.models import User
    from .firestore_alliance_service import send_invitation, get_alliance, get_members

    user_id = request.data.get('user_id')
    message = request.data.get('message', '')

    if not user_id:
        return Response({'error': 'user_id is required.'},
                        status=status.HTTP_400_BAD_REQUEST)

    # Only leaders/officers can invite
    members = get_members(str(alliance_id))
    caller  = next((m for m in members
                    if m['user_id'] == str(request.user.id)), None)
    if caller is None or caller.get('role') not in ('leader', 'officer'):
        return Response({'error': 'Only leaders and officers can invite members.'},
                        status=status.HTTP_403_FORBIDDEN)

    try:
        invited_user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    try:
        invitation = send_invitation(str(alliance_id), invited_user,
                                     request.user, message=message)
        # Notify invited user
        try:
            from notifications.views import create_notification
            create_notification(
                recipient=invited_user,
                actor=request.user,
                notif_type='system',
                title=f'Alliance invitation from {request.user.username}',
                message=(f'You have been invited to join '
                         f'[{invitation["alliance_tag"]}] {invitation["alliance_name"]}'),
                link='/pages/community.html',
            )
        except Exception:
            pass
        return Response({'invitation': invitation, 'message': 'Invitation sent!'},
                        status=status.HTTP_201_CREATED)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        return Response({'error': 'Could not send invitation.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_alliance_view(request):
    """Get the current user's alliance."""
    if not _use_fs():
        return Response({'alliance': None})

    from .firestore_alliance_service import get_user_alliance
    alliance = get_user_alliance(str(request.user.id))
    return Response({'alliance': alliance})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_invitations_view(request):
    """Get current user's pending alliance invitations."""
    if not _use_fs():
        return Response({'invitations': []})

    from .firestore_alliance_service import get_user_invitations
    invitations = get_user_invitations(str(request.user.id))
    return Response({'invitations': invitations})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def accept_invitation_view(request, invitation_id):
    """Accept an alliance invitation."""
    if not _use_fs():
        return Response({'message': 'Invitation accepted'})

    from .firestore_alliance_service import respond_to_invitation
    try:
        inv = respond_to_invitation(str(invitation_id), request.user, accept=True)
        return Response({'message': 'You have joined the alliance!', 'invitation': inv})
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        return Response({'error': 'Could not accept invitation.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def decline_invitation_view(request, invitation_id):
    """Decline an alliance invitation."""
    if not _use_fs():
        return Response({'message': 'Invitation declined'})

    from .firestore_alliance_service import respond_to_invitation
    try:
        inv = respond_to_invitation(str(invitation_id), request.user, accept=False)
        return Response({'message': 'Invitation declined.', 'invitation': inv})
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception:
        return Response({'error': 'Could not decline invitation.'},
                        status=status.HTTP_500_INTERNAL_SERVER_ERROR)
