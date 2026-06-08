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


class UserLoginSerializer(serializers.Serializer):
    """Serializer for user login — works with email or username."""
    username = serializers.CharField()   # accepts email or username
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        identifier = data.get('username', '').strip()
        password   = data.get('password', '').strip()

        if not identifier or not password:
            raise serializers.ValidationError('Username/email and password are required.')

        # Use our custom backend — handles email OR username lookup
        from django.contrib.auth import authenticate
        user = authenticate(request=self.context.get('request'),
                            username=identifier,
                            password=password)

        if user is None:
            raise serializers.ValidationError('Invalid credentials. Please check your email/username and password.')

        if not user.is_active:
            raise serializers.ValidationError('This account has been disabled.')

        data['user'] = user
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