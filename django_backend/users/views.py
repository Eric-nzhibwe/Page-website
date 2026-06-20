"""
User views for ARTX Platform API
"""
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.response import Response
from rest_framework.authtoken.models import Token
from django.contrib.auth import login
from django.db.models import F, Window
from django.db.models.functions import RowNumber
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from .models import User, UserActivity, UserSubmission
from .serializers import (
    UserRegistrationSerializer, UserLoginSerializer, UserProfileSerializer,
    UserActivitySerializer, UserSubmissionSerializer, LeaderboardSerializer,
    SocialConnectionSerializer
)
from .otp_service import otp_service


@method_decorator(csrf_exempt, name='dispatch')
class UserRegistrationView(generics.CreateAPIView):
    """User registration endpoint"""
    queryset = User.objects.all()
    serializer_class = UserRegistrationSerializer
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    
    def create(self, request, *args, **kwargs):
        print(f"📝 Registration request received: {request.method}")
        print(f"📊 Request data: {request.data}")
        print(f"📋 Content type: {request.content_type}")
        
        serializer = self.get_serializer(data=request.data)
        
        if not serializer.is_valid():
            print(f"❌ Registration serializer errors: {serializer.errors}")
            return Response({
                'error': 'Invalid data',
                'details': serializer.errors,
                'message': str(serializer.errors)
            }, status=status.HTTP_400_BAD_REQUEST)
        
        user = serializer.save()  # welcome email is sent inside serializer.create()

        # Create token for immediate login
        token, created = Token.objects.get_or_create(user=user)

        return Response({
            'user': UserProfileSerializer(user).data,
            'token': token.key,
            'message': 'Registration successful! Welcome to ARTX!'
        }, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def login_view(request):
    """User login endpoint — email or username, token-based."""
    identifier = (request.data.get('username') or '').strip()
    password   = (request.data.get('password') or '').strip()

    if not identifier:
        return Response({
            'error': 'validation_error',
            'message': 'Please enter your email or username.'
        }, status=status.HTTP_400_BAD_REQUEST)

    if not password:
        return Response({
            'error': 'validation_error',
            'message': 'Please enter your password.'
        }, status=status.HTTP_400_BAD_REQUEST)

    serializer = UserLoginSerializer(
        data={'username': identifier, 'password': password},
        context={'request': request}
    )

    if not serializer.is_valid():
        # Flatten serializer errors into a single readable message
        raw = serializer.errors
        if isinstance(raw, dict):
            msgs = []
            for v in raw.values():
                if isinstance(v, list):
                    msgs.extend([str(m) for m in v])
                else:
                    msgs.append(str(v))
            message = ' '.join(msgs)
        else:
            message = str(raw)

        return Response({
            'error': 'authentication_failed',
            'message': message
        }, status=status.HTTP_401_UNAUTHORIZED)

    user = serializer.validated_data['user']

    # Create or retrieve DRF token
    token, _ = Token.objects.get_or_create(user=user)

    # Establish Django session too (for browser clients)
    login(request, user, backend='users.backends.EmailOrUsernameBackend')

    # Send login notification email (non-blocking)
    try:
        from notifications.tasks import send_login_notification_email
        login_data = {
            'device_info': request.META.get('HTTP_USER_AGENT', 'Unknown device')[:120],
            'location_info': 'Secure connection',
            'active_tournaments_count': 'Several',
            'unread_notifications_count': 'Check',
        }
        send_login_notification_email(user.id, login_data)
    except Exception:
        pass  # Never block login if email fails

    return Response({
        'token': token.key,
        'user': UserProfileSerializer(user).data,
        'message': f'Welcome back, {user.username}! 🔥'
    }, status=status.HTTP_200_OK)


@api_view(['POST'])
def logout_view(request):
    """User logout endpoint"""
    if request.user.is_authenticated:
        # Delete token
        try:
            request.user.auth_token.delete()
        except:
            pass
    
    return Response({'message': 'Logged out successfully'})


class UserProfileView(generics.RetrieveUpdateAPIView):
    """User profile endpoint"""
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_object(self):
        return self.request.user


class UserActivitiesView(generics.ListAPIView):
    """User activities endpoint"""
    serializer_class = UserActivitySerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def get_queryset(self):
        return UserActivity.objects.filter(user=self.request.user)[:20]


class SubmitAnswerView(generics.CreateAPIView):
    """Submit challenge answer endpoint"""
    serializer_class = UserSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submission = serializer.save()
        
        # Return updated user profile
        user_data = UserProfileSerializer(request.user).data
        
        return Response({
            'submission': UserSubmissionSerializer(submission).data,
            'user': user_data,
            'message': f"{'Correct! +' + str(submission.points_earned) + ' prestige' if submission.is_correct else 'Incorrect. Try again!'}"
        }, status=status.HTTP_201_CREATED)


class LeaderboardView(generics.ListAPIView):
    """Leaderboard endpoint"""
    serializer_class = LeaderboardSerializer
    permission_classes = [permissions.AllowAny]
    
    def get_queryset(self):
        # Add rank annotation
        queryset = User.objects.annotate(
            rank=Window(
                expression=RowNumber(),
                order_by=F('prestige_points').desc()
            )
        ).order_by('-prestige_points')[:50]
        
        return queryset


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def discover_users_view(request):
    """
    Return a paginated list of users the current user does NOT yet follow,
    excluding themselves. Used for the "Discover Users" sidebar.
    """
    from django.db.models import Q
    from social.models import Follow

    already_following = Follow.objects.filter(
        follower=request.user
    ).values_list('following_id', flat=True)

    q = request.query_params.get('q', '').strip()

    qs = User.objects.exclude(
        Q(id=request.user.id) | Q(id__in=already_following)
    ).order_by('-prestige_points')

    if q:
        qs = qs.filter(
            Q(username__icontains=q) |
            Q(display_name__icontains=q)
        )

    qs = qs[:30]

    data = [
        {
            'id':           u.id,
            'username':     u.username,
            'display_name': u.display_name or u.username,
            'access_tier':  u.access_tier,
            'prestige_points': u.prestige_points,
            'profile_image': u.profile_image.url if u.profile_image else None,
        }
        for u in qs
    ]
    return Response(data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def search_users_view(request):
    """Search users by username or display_name."""
    q = request.query_params.get('q', '').strip()
    if not q:
        return Response([])

    from django.db.models import Q
    qs = User.objects.filter(
        Q(username__icontains=q) | Q(display_name__icontains=q)
    ).exclude(id=request.user.id).order_by('-prestige_points')[:20]

    data = [
        {
            'id':           u.id,
            'username':     u.username,
            'display_name': u.display_name or u.username,
            'access_tier':  u.access_tier,
            'prestige_points': u.prestige_points,
            'profile_image': u.profile_image.url if u.profile_image else None,
        }
        for u in qs
    ]
    return Response(data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def user_stats_view(request):
    """Get user statistics"""
    user = request.user
    
    # Calculate additional stats
    recent_activities = UserActivity.objects.filter(user=user)[:10]
    recent_submissions = UserSubmission.objects.filter(user=user)[:10]
    
    # Find user rank
    user_rank = User.objects.filter(prestige_points__gt=user.prestige_points).count() + 1
    total_users = User.objects.count()
    
    return Response({
        'user': UserProfileSerializer(user).data,
        'rank': user_rank,
        'total_users': total_users,
        'recent_activities': UserActivitySerializer(recent_activities, many=True).data,
        'recent_submissions': UserSubmissionSerializer(recent_submissions, many=True).data,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def add_social_connection_view(request):
    """Add social media connection"""
    serializer = SocialConnectionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    
    user = request.user
    user.add_social_connection(
        platform=serializer.validated_data['platform'],
        username=serializer.validated_data['username'],
        verified=serializer.validated_data.get('verified', False),
        profile_image_url=serializer.validated_data.get('profile_image_url')
    )
    
    return Response({
        'message': f"Successfully connected {serializer.validated_data['platform']} account!",
        'social_connections': user.get_social_connections()
    })


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def remove_social_connection_view(request, platform):
    """Remove social media connection"""
    user = request.user
    connections = user.get_social_connections()
    
    if platform in connections:
        del connections[platform]
        user.social_connections = connections
        user.save()
        
        return Response({
            'message': f"Successfully disconnected {platform} account",
            'social_connections': user.get_social_connections()
        })
    else:
        return Response({
            'error': f"No {platform} connection found"
        }, status=status.HTTP_404_NOT_FOUND)


@csrf_exempt
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def verify_otp_view(request):
    """Verify OTP and complete login"""
    session_id = request.data.get('session_id')
    otp_input = request.data.get('otp')
    username = request.data.get('username')
    
    if not all([session_id, otp_input, username]):
        return Response({
            'error': 'Missing required fields'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Verify OTP
    success, message, user_id = otp_service.verify_otp(session_id, otp_input)
    
    if not success:
        return Response({
            'error': message
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Get user
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({
            'error': 'User not found'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Create/get token
    token, created = Token.objects.get_or_create(user=user)
    
    # Log the user in
    login(request, user)
    
    print(f"✅ OTP verified and user logged in: {user.username}")
    
    return Response({
        'user': UserProfileSerializer(user).data,
        'token': token.key,
        'message': 'Login successful!'
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def resend_otp_view(request):
    """Resend OTP"""
    session_id = request.data.get('session_id')
    username = request.data.get('username')
    
    if not all([session_id, username]):
        return Response({
            'error': 'Missing required fields'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if can resend
    can_resend, message = otp_service.can_resend(session_id)
    if not can_resend:
        return Response({
            'error': message
        }, status=status.HTTP_429_TOO_MANY_REQUESTS)
    
    # Get user
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({
            'error': 'User not found'
        }, status=status.HTTP_404_NOT_FOUND)
    
    # Generate new OTP
    otp, new_session_id = otp_service.create_otp(user, session_id)
    
    # Send OTP
    otp_service.send_otp_email(user, otp)
    
    # Mark as resent
    otp_service.mark_resent(session_id)
    
    print(f"✅ OTP resent to {user.email}")
    
    return Response({
        'message': 'OTP sent successfully',
        'session_id': new_session_id
    })


# ─────────────────────────────────────────────────────────────────────────────
# Settings endpoints
# ─────────────────────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def change_password_view(request):
    """Change the authenticated user's password."""
    current_password = request.data.get('current_password', '').strip()
    new_password     = request.data.get('new_password', '').strip()

    if not current_password or not new_password:
        return Response(
            {'error': 'Both current_password and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < 8:
        return Response(
            {'error': 'New password must be at least 8 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    if not user.check_password(current_password):
        return Response(
            {'error': 'Current password is incorrect.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user.set_password(new_password)
    from django.utils import timezone as tz
    user.password_changed_at = tz.now()
    user.save()

    # Rotate token so existing sessions are invalidated
    from rest_framework.authtoken.models import Token
    Token.objects.filter(user=user).delete()
    new_token, _ = Token.objects.get_or_create(user=user)

    return Response({
        'message': 'Password changed successfully.',
        'token': new_token.key,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def upload_avatar_view(request):
    """Upload / replace the user's profile image."""
    if 'avatar' not in request.FILES:
        return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

    file = request.FILES['avatar']
    allowed_types = ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
    if file.content_type not in allowed_types:
        return Response({'error': 'Unsupported file type.'}, status=status.HTTP_400_BAD_REQUEST)

    if file.size > 5 * 1024 * 1024:  # 5 MB limit
        return Response({'error': 'File too large. Max 5 MB.'}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    user.profile_image = file
    user.save()

    request.build_absolute_uri(user.profile_image.url) if user.profile_image else None

    return Response({
        'message': 'Avatar updated successfully.',
        'avatar_url': request.build_absolute_uri(user.profile_image.url),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout_all_devices_view(request):
    """Invalidate all tokens for the current user (logout all devices)."""
    from rest_framework.authtoken.models import Token
    Token.objects.filter(user=request.user).delete()
    return Response({'message': 'Logged out from all devices successfully.'})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def active_sessions_view(request):
    """Return a list of active tokens / sessions for the current user."""
    from rest_framework.authtoken.models import Token
    tokens = Token.objects.filter(user=request.user).values('key', 'created')
    sessions = [
        {
            'key_preview': f"...{t['key'][-6:]}",
            'created': t['created'],
            'is_current': request.auth and request.auth.key == t['key'],
        }
        for t in tokens
    ]
    return Response({'sessions': sessions})


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def update_preferences_view(request):
    """Merge-update the user's stored preferences JSON."""
    user = request.user
    current = user.preferences or {}
    current.update(request.data)
    user.preferences = current
    user.save(update_fields=['preferences'])
    return Response({'message': 'Preferences saved.', 'preferences': user.preferences})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def deactivate_account_view(request):
    """Deactivate (soft-disable) the user's account."""
    password = request.data.get('password', '').strip()
    if not password or not request.user.check_password(password):
        return Response({'error': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    user.is_active = False
    user.save(update_fields=['is_active'])

    # Invalidate all tokens
    from rest_framework.authtoken.models import Token
    Token.objects.filter(user=user).delete()

    return Response({'message': 'Account deactivated. You can reactivate it by contacting support.'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def delete_account_view(request):
    """Permanently delete the user's account after password confirmation."""
    password = request.data.get('password', '').strip()
    confirm  = request.data.get('confirm', '').strip()

    if confirm != 'DELETE':
        return Response(
            {'error': 'Please send confirm="DELETE" to confirm deletion.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not password or not request.user.check_password(password):
        return Response({'error': 'Incorrect password.'}, status=status.HTTP_400_BAD_REQUEST)

    request.user.delete()
    return Response({'message': 'Account permanently deleted.'})
