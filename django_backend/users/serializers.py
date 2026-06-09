"""
User serializers — ARTX Platform
"""
from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User, UserActivity, UserSubmission


class UserRegistrationSerializer(serializers.ModelSerializer):
    """Serializer for user registration"""
    password         = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True, required=False)

    class Meta:
        model  = User
        fields = ['username', 'email', 'password', 'password_confirm', 'display_name']

    def validate_username(self, value):
        import re
        value = value.strip()
        if not re.match(r'^[a-zA-Z0-9_]+$', value):
            raise serializers.ValidationError(
                'Username can only contain letters, numbers, and underscores.'
            )
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('This username is already taken.')
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('An account with this email already exists.')
        return value

    def validate(self, data):
        password_confirm = data.get('password_confirm')
        if password_confirm and data['password'] != password_confirm:
            raise serializers.ValidationError({'password_confirm': "Passwords don't match."})
        return data

    def create(self, validated_data):
        validated_data.pop('password_confirm', None)
        password = validated_data.pop('password')

        user = User.objects.create_user(password=password, **validated_data)

        # Send welcome email — never block registration if this fails
        try:
            _send_welcome_email(user)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Welcome email failed for {user.email}: {e}")

        return user


def _send_welcome_email(user):
    """Send a welcome email to a newly registered user."""
    from django.core.mail import send_mail
    from django.conf import settings

    subject = 'Welcome to ARTX Platform!'
    plain = (
        f"Hi {user.username},\n\n"
        f"Your account has been created successfully. "
        f"You can now log in and start playing.\n\n"
        f"Welcome to ARTX!\n\nThe ARTX Team"
    )
    html = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family:Arial,sans-serif; background:#f4f4f4; margin:0; padding:0; }}
    .wrap {{ max-width:560px; margin:40px auto; background:#fff;
             border-radius:12px; overflow:hidden;
             box-shadow:0 4px 20px rgba(0,0,0,.08); }}
    .header {{ background:linear-gradient(135deg,#6c63ff,#3b2dbf);
               padding:36px; text-align:center; color:#fff; }}
    .header h1 {{ margin:0; font-size:26px; }}
    .body {{ padding:32px; color:#333; line-height:1.7; }}
    .btn {{ display:inline-block; margin:24px 0; padding:14px 36px;
            background:#6c63ff; color:#fff; border-radius:8px;
            text-decoration:none; font-weight:bold; font-size:16px; }}
    .footer {{ text-align:center; padding:20px; color:#aaa; font-size:12px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header"><h1>🎮 Welcome to ARTX!</h1></div>
    <div class="body">
      <p>Hi <strong>{user.username}</strong>,</p>
      <p>Your account has been created successfully. You're all set to start competing!</p>
      <a href="{getattr(settings, 'FRONTEND_BASE_URL', 'http://localhost:8000')}" class="btn">
        Go to ARTX
      </a>
      <p>Good luck and have fun!</p>
    </div>
    <div class="footer">© ARTX Platform &nbsp;|&nbsp; This is an automated message.</div>
  </div>
</body>
</html>
"""
    send_mail(
        subject=subject,
        message=plain,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=html,
        fail_silently=False,
    )


class UserLoginSerializer(serializers.Serializer):
    """Login with email or username."""
    username = serializers.CharField(label='Email or username')
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        identifier = data.get('username', '').strip()
        password   = data.get('password', '').strip()

        if not identifier or not password:
            raise serializers.ValidationError('Email/username and password are required.')

        user = authenticate(
            request=self.context.get('request'),
            username=identifier,
            password=password,
        )

        if user is None:
            raise serializers.ValidationError(
                'Invalid credentials. Please check your email/username and password.'
            )
        if not user.is_active:
            raise serializers.ValidationError('This account has been disabled.')

        data['user'] = user
        return data


class UserProfileSerializer(serializers.ModelSerializer):
    success_rate       = serializers.ReadOnlyField()
    social_connections = serializers.JSONField(read_only=True)

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'display_name', 'bio', 'profile_image',
            'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'social_connections',
            'created_at', 'last_login_date',
        ]
        read_only_fields = [
            'id', 'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'created_at', 'last_login_date',
        ]


class UserActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model  = UserActivity
        fields = ['id', 'activity_type', 'description', 'points_change', 'metadata', 'created_at']


class UserSubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = UserSubmission
        fields = ['id', 'challenge_id', 'answer', 'is_correct',
                  'points_earned', 'difficulty', 'submitted_at']
        read_only_fields = ['id', 'is_correct', 'points_earned', 'submitted_at']

    def create(self, validated_data):
        import random
        validated_data['user']       = self.context['request'].user
        validated_data['is_correct'] = random.random() > 0.3
        difficulty_points = {'easy': 10, 'medium': 25, 'hard': 50}
        validated_data['points_earned'] = difficulty_points.get(
            validated_data.get('difficulty', 'medium'), 25
        )
        return super().create(validated_data)


class LeaderboardSerializer(serializers.ModelSerializer):
    rank = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = ['id', 'username', 'display_name', 'prestige_points',
                  'level', 'access_tier', 'rank']

    def get_rank(self, obj):
        return getattr(obj, 'rank', None)


class SocialConnectionSerializer(serializers.Serializer):
    platform          = serializers.CharField(max_length=50)
    username          = serializers.CharField(max_length=100)
    verified          = serializers.BooleanField(default=False)
    profile_image_url = serializers.URLField(required=False)


class UserBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model        = User
        fields       = ['id', 'username', 'display_name', 'prestige_points', 'access_tier']
        read_only_fields = fields
