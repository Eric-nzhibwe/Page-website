"""
User views for ARTX Platform API
"""
from rest_framework import generics, status, permissions
from rest_framework.decorators import api_view, permission_classes
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
        
        user = serializer.save()
        
        # Create token for immediate login
        token, created = Token.objects.get_or_create(user=user)
        
        # Send welcome email
        try:
            from notifications.tasks import send_welcome_email
            send_welcome_email(user.id)
            print(f"✅ Welcome email sent to {user.email}")
        except Exception as e:
            print(f"⚠️ Could not send welcome email: {e}")
            # Don't fail registration if email fails
        
        return Response({
            'user': UserProfileSerializer(user).data,
            'token': token.key,
            'message': 'Registration successful! Welcome to ARTX!'
        }, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_view(request):
    """User login endpoint - Mobile optimized"""
    print(f"🔐 Login request received: {request.method}")
    print(f"📊 Request data: {request.data}")
    print(f"📋 Content type: {request.content_type}")
    print(f"📱 User Agent: {request.META.get('HTTP_USER_AGENT', 'Unknown')}")
    
    # Validate required fields
    username_or_email = request.data.get('username', '').strip() if request.data.get('username') else None
    password = request.data.get('password', '').strip() if request.data.get('password') else None
    
    print(f"🔍 Attempting login with username/email: {username_or_email}")
    
    # Provide specific error messages for missing fields
    if not username_or_email:
        print(f"❌ Missing username/email")
        return Response({
            'error': 'Invalid data',
            'details': {'username': ['Email or username is required']},
            'message': 'Please enter your email or username'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    if not password:
        print(f"❌ Missing password")
        return Response({
            'error': 'Invalid data',
            'details': {'password': ['Password is required']},
            'message': 'Please enter your password'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if user exists first (for better error messages)
    try:
        if '@' in username_or_email:
            check_user = User.objects.get(email__iexact=username_or_email)
        else:
            check_user = User.objects.get(username__iexact=username_or_email)
        print(f"✅ User found: {check_user.username} (email: {check_user.email})")
    except User.DoesNotExist:
        print(f"❌ User not found with identifier: {username_or_email}")
        return Response({
            'error': 'Invalid data',
            'details': {'non_field_errors': ['Invalid credentials']},
            'message': 'Email/username or password is incorrect'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate with serializer
    serializer = UserLoginSerializer(data={
        'username': username_or_email,
        'password': password
    })
    
    if not serializer.is_valid():
        print(f"❌ Serializer errors: {serializer.errors}")
        error_message = str(serializer.errors)
        
        # Provide user-friendly error messages
        if 'Invalid credentials' in error_message:
            message = 'Email/username or password is incorrect. Please check your password.'
        elif 'disabled' in error_message.lower():
            message = 'Your account has been disabled'
        else:
            message = 'Login failed. Please check your credentials'
        
        return Response({
            'error': 'Invalid data',
            'details': serializer.errors,
            'message': message
        }, status=status.HTTP_400_BAD_REQUEST)
    
    user = serializer.validated_data['user']
    
    # TEMPORARY: Skip OTP for testing - Remove after testing
    # TODO: Re-enable OTP after confirming login works
    print(f"⏭️  Skipping OTP for testing - user: {user.username}")
    
    login(request, user)
    token, created = Token.objects.get_or_create(user=user)
    
    print(f"✅ User logged in successfully: {user.username} (token: {token.key[:10]}...)")
    
    return Response({
        'user': UserProfileSerializer(user).data,
        'token': token.key,
        'message': f'Welcome back, {user.username}! 🔥'
    })


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
