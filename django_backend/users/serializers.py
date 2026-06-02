"""
User serializers for ARTX Platform API
"""
from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User, UserActivity, UserSubmission


class UserRegistrationSerializer(serializers.ModelSerializer):
    """Serializer for user registration"""
    password = serializers.CharField(write_only=True, min_length=6)
    password_confirm = serializers.CharField(write_only=True, required=False)
    
    class Meta:
        model = User
        fields = ['username', 'email', 'password', 'password_confirm', 'display_name']
    
    def validate(self, data):
        # Only check password confirmation if it's provided
        password_confirm = data.get('password_confirm')
        if password_confirm and data['password'] != password_confirm:
            raise serializers.ValidationError("Passwords don't match")
        return data
    
    def create(self, validated_data):
        # Remove password_confirm if it exists
        validated_data.pop('password_confirm', None)
        password = validated_data.pop('password')
        
        user = User.objects.create_user(
            password=password,
            **validated_data
        )
        
        # Send welcome email (async) - don't fail if Celery is unavailable
        try:
            from notifications.tasks import send_welcome_email
            send_welcome_email(user.id)
        except Exception as e:
            # Email sending failed, skip
            print(f"⚠️ Could not send welcome email: {e}")
            pass
        
        return user
        return user


class UserLoginSerializer(serializers.Serializer):
    """Serializer for user login"""
    username = serializers.CharField()  # Can be username or email
    password = serializers.CharField()
    
    def validate(self, data):
        username_or_email = data.get('username', '').strip()
        password = data.get('password', '').strip()
        
        if not username_or_email or not password:
            raise serializers.ValidationError('Must include username/email and password')
        
        # Try to find the user and get their email for authentication
        user = None
        authentication_username = None
        
        # First, try to find user by username or email
        try:
            if '@' in username_or_email:
                # It's an email
                user = User.objects.get(email__iexact=username_or_email)
                authentication_username = user.email
            else:
                # It's a username
                user = User.objects.get(username__iexact=username_or_email)
                authentication_username = user.email
        except User.DoesNotExist:
            # User doesn't exist
            raise serializers.ValidationError('Invalid credentials')
        
        # Now authenticate using the email (since USERNAME_FIELD is email)
        from django.contrib.auth import authenticate
        authenticated_user = authenticate(username=authentication_username, password=password)
        
        if authenticated_user:
            if authenticated_user.is_active:
                data['user'] = authenticated_user
            else:
                raise serializers.ValidationError('User account is disabled')
        else:
            # Authentication failed - wrong password
            raise serializers.ValidationError('Invalid credentials')
        
        return data


class UserProfileSerializer(serializers.ModelSerializer):
    """Serializer for user profile"""
    success_rate = serializers.ReadOnlyField()
    social_connections = serializers.JSONField(read_only=True)
    
    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'display_name', 'bio', 'profile_image',
            'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'social_connections',
            'created_at', 'last_login_date'
        ]
        read_only_fields = [
            'id', 'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'created_at', 'last_login_date'
        ]


class UserActivitySerializer(serializers.ModelSerializer):
    """Serializer for user activities"""
    
    class Meta:
        model = UserActivity
        fields = ['id', 'activity_type', 'description', 'points_change', 'metadata', 'created_at']


class UserSubmissionSerializer(serializers.ModelSerializer):
    """Serializer for user submissions"""
    
    class Meta:
        model = UserSubmission
        fields = ['id', 'challenge_id', 'answer', 'is_correct', 'points_earned', 'difficulty', 'submitted_at']
        read_only_fields = ['id', 'is_correct', 'points_earned', 'submitted_at']
    
    def create(self, validated_data):
        # Add user from request context
        validated_data['user'] = self.context['request'].user
        
        # Simulate answer checking (in real app, this would be more sophisticated)
        import random
        validated_data['is_correct'] = random.random() > 0.3  # 70% success rate
        
        # Calculate points based on difficulty
        difficulty_points = {
            'easy': 10,
            'medium': 25,
            'hard': 50
        }
        validated_data['points_earned'] = difficulty_points.get(validated_data.get('difficulty', 'medium'), 25)
        
        return super().create(validated_data)


class LeaderboardSerializer(serializers.ModelSerializer):
    """Serializer for leaderboard display"""
    rank = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'display_name', 'prestige_points', 'level', 'access_tier', 'rank']
    
    def get_rank(self, obj):
        # This would be calculated in the view
        return getattr(obj, 'rank', None)


class SocialConnectionSerializer(serializers.Serializer):
    """Serializer for social media connections"""
    platform = serializers.CharField(max_length=50)
    username = serializers.CharField(max_length=100)
    verified = serializers.BooleanField(default=False)
    profile_image_url = serializers.URLField(required=False)


class UserBasicSerializer(serializers.ModelSerializer):
    """Minimal serializer for user references in other models"""
    
    class Meta:
        model = User
        fields = ['id', 'username', 'display_name', 'prestige_points', 'access_tier']
        read_only_fields = fields