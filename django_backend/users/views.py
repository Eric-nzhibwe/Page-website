# -*- coding: utf-8 -*-
"""
User views for PAGE Platform API
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

        # Mirror new user to Firestore immediately (backup — non-blocking)
        try:
            from page_platform.firebase_client import firebase_enabled
            if firebase_enabled():
                from users.firestore_user_service import sync_user
                sync_user(user, request=request)
        except Exception:
            pass

        return Response({
            'user': UserProfileSerializer(user).data,
            'token': token.key,
            'message': 'Account creation successful! Welcome to PAGE!'
        }, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def login_view(request):
    """
    Legacy email/password login endpoint.

    When Firebase is configured (the default), the frontend authenticates
    with Firebase and exchanges the ID token at /api/auth/firebase-login/.
    This endpoint is kept as a fallback for environments where Firebase
    is not set up, or for users created before Firebase was enabled.

    If the database is unavailable, returns a helpful message directing
    the user to Firebase login instead of crashing with a 500.
    """
    import logging
    log = logging.getLogger('users.login')

    identifier = (request.data.get('username') or '').strip()
    password   = (request.data.get('password') or '')   # do NOT strip passwords

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

    # ── Diagnostic logging (visible in Render logs) ───────────────────────
    identifier_type = 'email' if '@' in identifier else 'username'
    log.info('LOGIN attempt: identifier_type=%s len(password)=%d', identifier_type, len(password))

    # Check whether the user exists — catch DB errors gracefully
    try:
        if '@' in identifier:
            _u = User.objects.get(email__iexact=identifier)
        else:
            _u = User.objects.get(username__iexact=identifier)
        log.info('LOGIN user found: id=%s has_usable_password=%s is_active=%s',
                 _u.pk, _u.has_usable_password(), _u.is_active)
    except User.DoesNotExist:
        log.warning('LOGIN user NOT found for identifier=%r', identifier)
    except Exception as exc:
        log.error('LOGIN user lookup error: %s', exc)
        # Database is unavailable — redirect to Firebase login
        return Response({
            'error': 'database_unavailable',
            'message': 'Sign in is handled by Firebase. Please use the Firebase login flow.',
        }, status=status.HTTP_503_SERVICE_UNAVAILABLE)

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
        from users.email_service import email_service
        ip      = (request.META.get('HTTP_X_FORWARDED_FOR') or
                   request.META.get('REMOTE_ADDR', 'Unknown')).split(',')[0].strip()
        device  = request.META.get('HTTP_USER_AGENT', 'Unknown browser')[:120]
        email_service.send_login_notification(user, ip_address=ip, device=device)
    except Exception:
        pass  # Never block login if email fails

    # Send login alert SMS (non-blocking, only if user has a phone number)
    try:
        from users.sms_service import sms_service
        sms_service.send_login_alert(user)
    except Exception:
        pass  # Never block login if SMS fails

    # ── Mirror to Firestore (always, as a backup — non-blocking) ──────────
    try:
        from page_platform.firebase_client import firebase_enabled
        if firebase_enabled():
            from users.firestore_user_service import sync_user
            sync_user(user, request=request)
    except Exception:
        pass  # Never block login if Firestore sync fails

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
    """
    User profile endpoint.

    When the authenticated user is a real Django User (DB available),
    reads/writes work normally.  When the user is an ``EphemeralUser``
    (Firebase-only mode), GET returns the ephemeral user's attributes
    and PATCH updates the Firestore profile document instead.
    """
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def retrieve(self, request, *args, **kwargs):
        user = request.user

        # Ephemeral user — return its attributes directly (no DB needed)
        from users.firebase_token_auth import EphemeralUser
        if isinstance(user, EphemeralUser):
            return Response(self._ephemeral_profile(user))

        return super().retrieve(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        user = request.user

        # Ephemeral user — can't save to DB, update Firestore instead
        from users.firebase_token_auth import EphemeralUser
        if isinstance(user, EphemeralUser):
            return self._update_firestore_profile(user, request.data)

        return super().update(request, *args, **kwargs)

    # Alias for PATCH (partial update)
    partial_update = update

    @staticmethod
    def _ephemeral_profile(user):
        """Build a profile dict from an EphemeralUser (no DB access)."""
        return {
            'id':                     user.id,
            'username':               user.username,
            'email':                  user.email,
            'display_name':           user.display_name,
            'bio':                    user.bio,
            'profile_image':          user.avatar_url or None,
            'profile_image_url':      user.avatar_url or None,
            'phone':                  user.phone,
            'date_of_birth':          user.date_of_birth,
            'location':               user.location,
            'website':                user.website,
            'preferences':            user.preferences,
            'prestige_points':        user.prestige_points,
            'level':                  user.level,
            'power_rank':             user.power_rank,
            'access_tier':            user.access_tier,
            'current_streak':         user.current_streak,
            'total_submissions':     user.total_submissions,
            'successful_submissions': user.successful_submissions,
            'success_rate':           user.success_rate,
            'total_earnings':         float(user.total_earnings),
            'tournament_wins':        user.tournament_wins,
            'is_verified':            user.is_verified,
            'verification_level':     user.verification_level,
            'social_connections':     user.social_connections,
            'created_at':             user.created_at,
            'last_login_date':        user.last_login_date,
            'followers_count':        0,
            'following_count':         0,
        }

    @staticmethod
    def _update_firestore_profile(user, data):
        """Update the user's profile in Firestore (ephemeral user mode)."""
        try:
            from users.firestore_user_service import update_user_fields
            # Only update safe, non-sensitive fields
            safe_fields = {}
            for key in ('display_name', 'bio', 'location', 'website',
                        'preferences', 'social_connections'):
                if key in data:
                    safe_fields[key] = data[key]
            if safe_fields:
                update_user_fields(user.id, safe_fields)
                return Response({
                    'message': 'Profile updated (Firestore mode).',
                    **UserProfileView._ephemeral_profile(user),
                })
        except Exception as exc:
            return Response(
                {'error': f'Could not update profile: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        return Response({'message': 'No fields to update.'})


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

    def list(self, request, *args, **kwargs):
        from django.conf import settings
        if settings.FIRESTORE_COLLECTIONS.get('users', False):
            from users.firestore_user_service import get_leaderboard
            data = get_leaderboard(limit=50)
            # Add rank number client-side style
            for i, u in enumerate(data, start=1):
                u['rank'] = i
            return Response(data)
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
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
    from django.conf import settings
    from social.models import Follow

    q       = request.query_params.get('q', '').strip()
    use_fs  = settings.FIRESTORE_COLLECTIONS.get('users', False)

    if use_fs:
        from users.firestore_user_service import search_users, get_leaderboard
        already_following = set(str(uid) for uid in
            Follow.objects.filter(follower=request.user)
                          .values_list('following_id', flat=True))
        if q:
            candidates = search_users(q, exclude_user_id=str(request.user.id))
        else:
            candidates = get_leaderboard(limit=50)

        data = [u for u in candidates
                if u['id'] != str(request.user.id)
                and u['id'] not in already_following][:30]
        return Response(data)

    already_following = Follow.objects.filter(
        follower=request.user
    ).values_list('following_id', flat=True)

    qs = User.objects.exclude(
        Q(id=request.user.id) | Q(id__in=already_following)
    ).order_by('-prestige_points')

    if q:
        qs = qs.filter(
            Q(username__icontains=q) | Q(display_name__icontains=q)
        )

    def _best_avatar(u):
        """Return the best available avatar URL for a user object."""
        # avatar_url is a base64 data URI or CDN URL — always works
        if getattr(u, 'avatar_url', ''):
            return u.avatar_url
        # profile_image is a legacy ImageField — only return if the file exists
        if u.profile_image:
            try:
                if u.profile_image.storage.exists(u.profile_image.name):
                    return u.profile_image.url
            except Exception:
                pass
        return None

    data = [
        {
            'id':               u.id,
            'username':         u.username,
            'display_name':     u.display_name or u.username,
            'access_tier':      u.access_tier,
            'prestige_points':  u.prestige_points,
            'profile_image':    _best_avatar(u),
            'profile_image_url': _best_avatar(u),
        }
        for u in qs[:30]
    ]
    return Response(data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def search_users_view(request):
    """Search users by username or display_name."""
    from django.conf import settings
    q = request.query_params.get('q', '').strip()
    if not q:
        return Response([])

    if settings.FIRESTORE_COLLECTIONS.get('users', False):
        from users.firestore_user_service import search_users
        return Response(search_users(q, exclude_user_id=str(request.user.id)))

    from django.db.models import Q
    qs = User.objects.filter(
        Q(username__icontains=q) | Q(display_name__icontains=q)
    ).exclude(id=request.user.id).order_by('-prestige_points')[:20]

    data = [
        {
            'id':            u.id,
            'username':      u.username,
            'display_name':  u.display_name or u.username,
            'access_tier':   u.access_tier,
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
    
    # Send OTP via email and SMS
    otp_service.send_otp_email(user, otp)
    otp_service.send_otp_sms(user, otp)
    
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
    """
    Upload / replace the user's profile avatar.

    Accepts a multipart file upload ('avatar' field).
    Resizes the image to 256×256, converts it to a JPEG base64 data URI,
    and stores it in user.avatar_url — no external storage service required.
    """
    if 'avatar' not in request.FILES:
        return Response({'error': 'No file provided.'}, status=status.HTTP_400_BAD_REQUEST)

    file = request.FILES['avatar']
    allowed_types = ('image/jpeg', 'image/png', 'image/gif', 'image/webp')
    if file.content_type not in allowed_types:
        return Response({'error': 'Unsupported file type.'}, status=status.HTTP_400_BAD_REQUEST)

    if file.size > 5 * 1024 * 1024:  # 5 MB limit
        return Response({'error': 'File too large. Max 5 MB.'}, status=status.HTTP_400_BAD_REQUEST)

    # ── Resize to 256×256 and encode as base64 data URI ──────────────────────
    try:
        from PIL import Image
        import io, base64

        img = Image.open(file)

        # Convert palette / RGBA modes to RGB so JPEG save works
        if img.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', img.size, (255, 255, 255))
            if img.mode == 'P':
                img = img.convert('RGBA')
            background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        # Crop to square from centre, then resize
        w, h   = img.size
        side   = min(w, h)
        left   = (w - side) // 2
        top    = (h - side) // 2
        img    = img.crop((left, top, left + side, top + side))
        img    = img.resize((256, 256), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=85, optimize=True)
        encoded = base64.b64encode(buf.getvalue()).decode('utf-8')
        data_uri = f'data:image/jpeg;base64,{encoded}'

    except Exception as exc:
        import logging
        logging.getLogger(__name__).error(f'Avatar resize failed: {exc}')
        return Response({'error': 'Could not process image.'}, status=status.HTTP_400_BAD_REQUEST)

    user = request.user
    user.avatar_url = data_uri
    user.save(update_fields=['avatar_url'])

    # Sync to Firestore so the avatar appears in discover list, stories, messenger
    try:
        from page_platform.firebase_client import get_firestore
        db = get_firestore()
        if db:
            db.collection('user_profiles').document(str(user.id)).set(
                {
                    'avatar_url':        data_uri,
                    'profile_image':     data_uri,
                    'profile_image_url': data_uri,
                },
                merge=True,
            )
    except Exception:
        pass  # Firestore sync is best-effort

    # Push avatar update to all followers via WebSocket so their pages update
    # immediately without a reload (avatars in post cards, suggest list, etc.)
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from social.consumers import _follower_group
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(
                _follower_group(str(user.id)),
                {
                    'type':       'user_feed_avatar_updated',
                    'user_id':    str(user.id),
                    'username':   user.username,
                    'avatar_url': data_uri,
                }
            )
    except Exception:
        pass  # WS broadcast is best-effort

    return Response({
        'message': 'Avatar updated successfully.',
        'avatar_url':        data_uri,
        'profile_image_url': data_uri,
        'profile_image':     data_uri,
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


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def firebase_token_login_view(request):
    """
    Exchange a Firebase ID token for an auth credential.

    Called by the frontend after Firebase Auth completes sign-in/sign-up.
    The frontend sends ``{ "firebase_token": "<Firebase ID token>" }``.

    Response shape (DB available — full mode):
        { "token": "<DRF token>", "firebase_token": "<ID token>",
          "user": {...}, "message": "..." }

    Response shape (DB unavailable — Firebase-only mode):
        { "firebase_token": "<ID token>", "user": {...},
          "source": "firestore", "message": "..." }

    In Firebase-only mode, the frontend stores the Firebase ID token and
    uses ``Authorization: FirebaseToken <token>`` for all subsequent API
    calls — the ``FirebaseTokenAuthentication`` DRF class verifies it
    without needing the database.
    """
    firebase_token = request.data.get('firebase_token', '').strip()
    if not firebase_token:
        return Response(
            {'error': 'firebase_token is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from page_platform.firebase_client import firebase_enabled
    if not firebase_enabled():
        return Response(
            {'error': 'Firebase Auth is not configured on this server.', 'fallback': True},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    # ── 1. Verify the Firebase ID token ──────────────────────────────────
    try:
        import firebase_admin.auth as fb_auth
        decoded = fb_auth.verify_id_token(firebase_token)
    except Exception as exc:
        return Response(
            {'error': f'Invalid or expired Firebase token: {exc}'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    firebase_uid = decoded.get('uid', '')
    email        = (decoded.get('email') or '').lower().strip()
    name         = decoded.get('name') or ''

    # ── 2. Try to get/create a Django User + DRF token (best-effort) ──────
    db_user = None
    drf_token = None
    try:
        from users.firebase_auth_backend import FirebaseAuthenticationBackend
        backend = FirebaseAuthenticationBackend()
        db_user = backend._get_or_create_user(decoded)

        if db_user is not None and db_user.is_active:
            drf_token, _ = Token.objects.get_or_create(user=db_user)
    except Exception as exc:
        import logging
        logging.getLogger('users.login').warning(
            'firebase_token_login: DB unavailable (%s) — using Firebase-only mode',
            exc,
        )

    # ── 3. Build the user profile ─────────────────────────────────────────
    if db_user is not None and drf_token:
        # Full mode — DB is working, return DRF token + serialized user
        try:
            from page_platform.firebase_client import firebase_enabled
            if firebase_enabled():
                from users.firestore_user_service import sync_user
                sync_user(db_user, request=request)
        except Exception:
            pass

        return Response({
            'token':          drf_token.key,
            'firebase_token': firebase_token,
            'user':           UserProfileSerializer(db_user).data,
            'message':        f'Welcome, {db_user.username}! 🔥',
        })

    # ── 4. Firebase-only mode — DB is down, build profile from Firestore ─
    user_profile = _build_firebase_only_profile(decoded, firebase_token)

    return Response({
        'firebase_token': firebase_token,
        'user':           user_profile,
        'source':         'firestore',
        'message':        f'Welcome, {user_profile.get("username", "player")}! 🔥',
    })


def _build_firebase_only_profile(decoded, firebase_token):
    """
    Build a user profile dict from the decoded Firebase token and,
    if available, the Firestore ``user_profiles`` document.
    Works with zero database access.
    """
    firebase_uid = decoded.get('uid', '')
    email        = (decoded.get('email') or '').lower().strip()
    name         = decoded.get('name') or ''
    picture      = decoded.get('picture') or ''

    # Try Firestore first
    profile = None
    try:
        from page_platform.firebase_client import get_firestore
        from google.cloud.firestore_v1 import FieldFilter
        db = get_firestore()
        if db is not None:
            docs = (
                db.collection('user_profiles')
                .where(filter=FieldFilter('firebase_uid', '==', firebase_uid))
                .limit(1)
                .stream()
            )
            for doc in docs:
                profile = doc.to_dict()
                profile['id'] = doc.id
                break
    except Exception:
        pass

    if profile:
        # Enrich with email (not stored in Firestore for privacy)
        profile['email'] = email
        if picture and not profile.get('profile_image_url'):
            profile['profile_image_url'] = picture
            profile['profile_image'] = picture
        return profile

    # Minimal profile from decoded token only
    return {
        'id':              firebase_uid,
        'username':        name or (email.split('@')[0] if email else firebase_uid[:12]),
        'display_name':    name or '',
        'email':           email,
        'profile_image_url': picture or None,
        'profile_image':   picture or None,
        'bio':             '',
        'access_tier':     'Bronze',
        'prestige_points': 0,
        'level':           1,
        'power_rank':      'Novice',
        'current_streak':  0,
        'total_submissions': 0,
        'successful_submissions': 0,
        'tournament_wins': 0,
        'total_earnings':  0.0,
        'is_verified':     decoded.get('email_verified', False),
        'verification_level': 1 if decoded.get('email_verified') else 0,
        'location':        '',
        'website':         '',
        'social_connections': {},
        'preferences':     {},
        'followers_count': 0,
        'following_count': 0,
    }


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def resolve_email_view(request):
    """
    Resolve a username to its email address so the frontend Firebase SDK
    can sign in with email+password even when the user typed a username.

    Tries the Django DB first; if the DB is unavailable, falls back to
    Firestore user_profiles collection.

    Request:  { "username": "someuser" }
    Response: { "email": "user@example.com" }  or 404
    """
    username = (request.data.get('username') or '').strip()
    if not username or '@' in username:
        return Response({'error': 'A username (not email) is required.'},
                        status=status.HTTP_400_BAD_REQUEST)

    # ── Try Django DB first ────────────────────────────────────────────────
    try:
        user = User.objects.get(username__iexact=username)
        if not user.is_active:
            return Response({'error': 'Account not found.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response({'email': user.email})
    except User.DoesNotExist:
        pass
    except Exception:
        # DB unavailable — fall through to Firestore
        pass

    # ── Firestore fallback ─────────────────────────────────────────────────
    try:
        from page_platform.firebase_client import firebase_enabled, get_firestore
        if firebase_enabled():
            from google.cloud.firestore_v1 import FieldFilter
            db = get_firestore()
            if db is not None:
                q = username.lower()
                docs = (
                    db.collection('user_profiles')
                    .where(filter=FieldFilter('username', '==', username))
                    .limit(1)
                    .stream()
                )
                for doc in docs:
                    d = doc.to_dict()
                    # Firestore doesn't store email for privacy — try Firebase Auth
                    firebase_uid = d.get('firebase_uid', '')
                    if firebase_uid:
                        try:
                            import firebase_admin.auth as fb_auth
                            user_record = fb_auth.get_user(firebase_uid)
                            if user_record.email:
                                return Response({'email': user_record.email})
                        except Exception:
                            pass
                    break
    except Exception:
        pass

    # Return 404 without revealing whether the username exists
    return Response({'error': 'Account not found.'},
                    status=status.HTTP_404_NOT_FOUND)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def google_config_view(request):
    """
    Return the public Google OAuth Client ID so the frontend GIS button can
    initialise without the value being hardcoded in HTML.
    Only the Client ID is returned — it is a public value safe to expose.
    """
    from django.conf import settings as _s
    client_id = getattr(_s, 'GOOGLE_CLIENT_ID', '')
    if not client_id:
        return Response({'error': 'Google Sign-In is not configured.'}, status=503)
    return Response({'client_id': client_id})


@api_view(['GET'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def firebase_config_view(request):
    """
    Return the public Firebase web config so the frontend can initialise
    the Firebase JS SDK without hardcoding keys in HTML.
    Only public-safe keys are returned (never private_key or client secrets).
    """
    from django.conf import settings as _s
    return Response({
        'projectId':         getattr(_s, 'FIREBASE_PROJECT_ID', ''),
        'apiKey':            getattr(_s, 'FIREBASE_WEB_API_KEY', ''),
        'authDomain':        getattr(_s, 'FIREBASE_AUTH_DOMAIN', ''),
        'storageBucket':     getattr(_s, 'FIREBASE_STORAGE_BUCKET', ''),
        'messagingSenderId': getattr(_s, 'FIREBASE_MESSAGING_SENDER_ID', ''),
        'appId':             getattr(_s, 'FIREBASE_APP_ID', ''),
    })


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def firestore_profile_view(request):
    """
    Postgres-free user profile lookup — reads from Firestore only.

    Called by the frontend as a fallback when Postgres is down (Render free
    tier DB suspension). The frontend exchanges a Firebase ID token for the
    user's public profile stored in Firestore.

    Request body:  { "firebase_token": "<Firebase ID token>" }
    Response:      { "user": { ...public profile fields... }, "source": "firestore" }
    """
    firebase_token = request.data.get('firebase_token', '').strip()
    if not firebase_token:
        return Response({'error': 'firebase_token is required.'}, status=400)

    from page_platform.firebase_client import firebase_enabled, get_firestore
    from google.cloud.firestore_v1 import FieldFilter
    if not firebase_enabled():
        return Response({'error': 'Firebase not configured.'}, status=503)

    # Verify the Firebase ID token
    try:
        import firebase_admin.auth as fb_auth
        decoded = fb_auth.verify_id_token(firebase_token)
    except Exception as exc:
        return Response({'error': f'Invalid Firebase token: {exc}'}, status=401)

    firebase_uid = decoded.get('uid')
    email        = (decoded.get('email') or '').lower().strip()

    # Look up Firestore profile by firebase_uid first, then email
    db = get_firestore()
    if db is None:
        return Response({'error': 'Firestore not available.'}, status=503)

    profile = None

    # Search by firebase_uid in user_profiles
    try:
        docs = (db.collection('user_profiles')
                  .where(filter=FieldFilter('firebase_uid', '==', firebase_uid))
                  .limit(1)
                  .stream())
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            profile = d
            break
    except Exception:
        pass

    # Fallback: search by email field if we stored it (we store username, not email)
    # Fall back to firebase decoded data to build a minimal profile
    if profile is None:
        profile = {
            'id':              firebase_uid,
            'username':        decoded.get('name') or email.split('@')[0],
            'display_name':    decoded.get('name') or '',
            'email':           email,
            'access_tier':     'Bronze',
            'prestige_points': 0,
            'level':           1,
            'is_verified':     decoded.get('email_verified', False),
            'source':          'firebase_token_only',
        }
    else:
        profile['email'] = email  # add email from token (not stored in Firestore)

    profile['source'] = 'firestore'
    return Response({'user': profile})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def spend_prestige_view(request):
    """Deduct prestige points for a reward purchase."""
    amount = request.data.get('amount')
    reason = request.data.get('reason', 'Reward redemption')

    try:
        amount = int(amount)
        if amount <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return Response({'error': 'Invalid amount.'}, status=status.HTTP_400_BAD_REQUEST)

    success = request.user.spend_prestige(amount, reason)
    if not success:
        return Response(
            {'error': f'Insufficient prestige. You have {request.user.prestige_points} pts.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return Response({
        'message': f'Successfully redeemed "{reason}".',
        'prestige_points': request.user.prestige_points,
    })


# ─────────────────────────────────────────────────────────────────────────────
# Password Reset
# ─────────────────────────────────────────────────────────────────────────────

@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def password_reset_request_view(request):
    """
    Step 1 -- User submits their email.
    Generates a secure token, stores it in cache, and emails a reset link.
    Always returns 200 so we never reveal whether an email is registered.
    """
    import secrets
    from django.core.cache import cache
    from django.conf import settings

    email = (request.data.get('email') or '').strip().lower()
    if not email:
        return Response(
            {'error': 'Please enter your email address.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Always respond with success -- don't reveal account existence
    generic_ok = Response({
        'message': (
            "If that email is registered, you'll receive a reset link shortly. "
            "Check your spam folder if it doesn't arrive within a few minutes."
        )
    })

    try:
        user = User.objects.get(email__iexact=email)
    except User.DoesNotExist:
        return generic_ok  # silent — don't expose whether email exists

    # Rate-limit: one request per 2 minutes per user
    rate_key = f'pwd_reset_rate_{user.id}'
    if cache.get(rate_key):
        return Response(
            {'error': 'A reset link was already sent recently. Please wait a moment.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Generate a secure token and store uid+token in cache (1 hour TTL)
    token    = secrets.token_urlsafe(48)
    cache_key = f'pwd_reset_{token}'
    cache.set(cache_key, {'user_id': user.id}, timeout=3600)
    cache.set(rate_key, True, timeout=120)

    # Build the reset URL -- points to the frontend page
    frontend_base = getattr(settings, 'FRONTEND_BASE_URL', 'http://localhost:8000').rstrip('/')
    reset_url = f'{frontend_base}/pages/forgot-password.html?token={token}'

    # Send email + SMS reset notifications
    try:
        from users.email_service import email_service
        email_service.send_password_reset(user, reset_url, expiry_hours=1)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f'Password reset email failed for {email}: {e}')

    try:
        from users.sms_service import sms_service
        sms_service.send_password_reset(user, reset_url)
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f'Password reset SMS failed for {email}: {e}')

    return generic_ok


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def password_reset_confirm_view(request):
    """
    Step 2 -- User submits new password + the token from the email link.
    Validates token, sets the new password, invalidates all existing tokens.
    """
    from django.core.cache import cache

    token        = (request.data.get('token') or '').strip()
    new_password = (request.data.get('new_password') or '').strip()
    confirm      = (request.data.get('confirm_password') or '').strip()

    if not token:
        return Response({'error': 'Reset token is missing.'}, status=status.HTTP_400_BAD_REQUEST)
    if not new_password:
        return Response({'error': 'Please enter a new password.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(new_password) < 8:
        return Response({'error': 'Password must be at least 8 characters.'}, status=status.HTTP_400_BAD_REQUEST)
    if new_password != confirm:
        return Response({'error': 'Passwords do not match.'}, status=status.HTTP_400_BAD_REQUEST)

    # Look up token in cache
    cache_key = f'pwd_reset_{token}'
    data = cache.get(cache_key)
    if not data:
        return Response(
            {'error': 'This reset link has expired or already been used. Please request a new one.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user = User.objects.get(id=data['user_id'])
    except User.DoesNotExist:
        return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

    # Set new password
    user.set_password(new_password)
    user.save(update_fields=['password'])

    # Invalidate the token immediately (one-time use)
    cache.delete(cache_key)

    # Invalidate all existing auth tokens so old sessions can't continue
    Token.objects.filter(user=user).delete()

    return Response({'message': 'Password reset successfully. You can now log in with your new password.'})


# ─────────────────────────────────────────────────────────────────────────────
#  GOOGLE IDENTITY SERVICES — "Continue with Google"
#  Endpoint: POST /api/auth/google-login/
#
#  Flow:
#    1.  Frontend loads the Google Identity Services script and renders a
#        "Sign in with Google" button.
#    2.  User picks their account — Google returns a signed JWT (credential).
#    3.  Frontend POSTs   { "credential": "<JWT>" }   to this endpoint.
#    4.  We verify the JWT signature using Google's public keys (via the
#        official google-auth library — no manual key fetching needed).
#    5.  Extract the verified claims: sub, email, name, picture.
#    6.  get_or_create the Django User (email as key), fill in profile fields.
#    7.  Issue / reuse a DRF Token and return the same response shape as the
#        regular login endpoint so the frontend needs zero changes downstream.
# ─────────────────────────────────────────────────────────────────────────────

@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
def google_login_view(request):
    """
    Verify a Google Identity Services JWT and sign the user in.

    Request body:
        { "credential": "<Google JWT string>" }

    Success response (200):
        { "token": "<DRF token>", "user": {...}, "message": "...", "created": bool }

    Error responses:
        400  — credential missing or token verification failed
        500  — unexpected server error
    """
    from django.conf import settings as _s

    credential = (request.data.get('credential') or '').strip()
    if not credential:
        return Response(
            {'error': 'credential is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── 1. Verify the JWT using the google-auth library ───────────────────────
    # google.oauth2.id_token.verify_oauth2_token() fetches Google's public keys
    # once, caches them, and validates the signature + expiry + audience claim.
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests

        client_id = getattr(_s, 'GOOGLE_CLIENT_ID', '')
        if not client_id:
            return Response(
                {'error': 'Google Sign-In is not configured on this server.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        id_info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
            clock_skew_in_seconds=10,   # tolerates minor clock drift
        )
    except ValueError as exc:
        # Covers expired tokens, wrong audience, bad signature, etc.
        return Response(
            {'error': f'Invalid Google credential: {exc}'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception('Google token verification failed')
        return Response(
            {'error': 'Could not verify Google credential. Please try again.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # ── 2. Extract verified claims from the token ─────────────────────────────
    google_id  = id_info['sub']                       # stable unique Google user id
    email      = id_info.get('email', '').lower().strip()
    name       = id_info.get('name', '')
    picture    = id_info.get('picture', '')           # Google CDN URL
    given_name = id_info.get('given_name', '')
    email_ok   = id_info.get('email_verified', False)

    if not email:
        return Response(
            {'error': 'Google account does not have a verified email address.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ── 3. Upsert the Django user ─────────────────────────────────────────────
    # Strategy:
    #   • Look up by email first — handles users who registered via email/password
    #     with the same address and now sign in via Google.
    #   • If the user is brand-new, generate a safe username from their name.
    #   • Always refresh display_name and avatar_url from Google (non-destructive
    #     — only overwrites if the user hasn't set a custom value yet).

    import re, secrets as _secrets

    created = False
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        # Build a unique username: lowercase name, strip non-word chars, add suffix
        base = re.sub(r'\W+', '', (given_name or name or email.split('@')[0])).lower()[:20] or 'user'
        username = base
        suffix = 1
        while User.objects.filter(username__iexact=username).exists():
            username = f'{base}{suffix}'
            suffix += 1

        user = User.objects.create_user(
            email=email,
            username=username,
            password=_secrets.token_urlsafe(32),   # random unguessable password
            display_name=name or username,
        )
        created = True

        # ── HOOK: additional new-user setup goes here ─────────────────────────
        # e.g. create Stripe customer, send welcome email, assign free tier, etc.
        try:
            from users.email_service import email_service
            email_service.send_welcome(user)
        except Exception:
            pass
        # ─────────────────────────────────────────────────────────────────────

    # ── 4. Update profile fields that Google keeps fresh ─────────────────────
    update_fields = []

    # Only backfill display_name if the user hasn't set one yet
    if name and not user.display_name:
        user.display_name = name
        update_fields.append('display_name')

    # Always refresh avatar_url from Google so it stays current
    if picture and user.avatar_url != picture:
        user.avatar_url = picture
        update_fields.append('avatar_url')

    # Mark email as verified (Google guarantees this)
    if email_ok and user.verification_level < 1:
        user.verification_level = 1
        user.is_verified = True
        update_fields += ['verification_level', 'is_verified']

    if update_fields:
        user.save(update_fields=update_fields)

    # ── 5. Store / refresh the Google provider link ───────────────────────────
    # UserFirebaseProfile is reused here as a generic OAuth provider link table.
    # google_id → firebase_uid column, picture → picture_url.
    try:
        from users.models import UserFirebaseProfile
        UserFirebaseProfile.objects.update_or_create(
            firebase_uid=f'google:{google_id}',
            defaults={'user': user, 'picture_url': picture or ''},
        )
    except Exception:
        pass   # non-critical — don't break login if this fails

    # ── 6. Issue DRF token and return ─────────────────────────────────────────
    drf_token, _ = Token.objects.get_or_create(user=user)

    return Response({
        'token':   drf_token.key,
        'user':    UserProfileSerializer(user).data,
        'message': f"Welcome{'! 🎉' if created else ' back! 🔥'} {user.display_name or user.username}",
        'created': created,
    }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
