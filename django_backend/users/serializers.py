# -*- coding: utf-8 -*-
"""
User serializers - ARTX Platform
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
            raise serializers.ValidationError({"password_confirm": "Passwords don't match."})
        return data

    def create(self, validated_data):
        validated_data.pop('password_confirm', None)
        password = validated_data.pop('password')

        user = User.objects.create_user(password=password, **validated_data)

        # Send welcome email + SMS via the central services.
        # Never block registration if this fails.
        try:
            from users.email_service import email_service
            email_service.send_welcome(user)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Welcome email failed for %s: %s", user.email, exc
            )

        try:
            from users.sms_service import sms_service
            sms_service.send_welcome(user)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Welcome SMS failed for %s: %s", user.username, exc
            )

        return user


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
    followers_count    = serializers.SerializerMethodField()
    following_count    = serializers.SerializerMethodField()
    profile_image_url  = serializers.SerializerMethodField()

    class Meta:
        model  = User
        fields = [
            'id', 'username', 'email', 'display_name', 'bio', 'profile_image',
            'profile_image_url',
            'phone', 'date_of_birth', 'location', 'website', 'preferences',
            'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'social_connections',
            'created_at', 'last_login_date',
            'followers_count', 'following_count',
        ]
        read_only_fields = [
            'id', 'prestige_points', 'level', 'power_rank', 'access_tier',
            'current_streak', 'total_submissions', 'successful_submissions',
            'success_rate', 'total_earnings', 'tournament_wins',
            'is_verified', 'verification_level', 'created_at', 'last_login_date',
            'followers_count', 'following_count', 'profile_image_url',
        ]

    def get_followers_count(self, obj):
        return obj.followers.count()

    def get_following_count(self, obj):
        return obj.following.count()

    def get_profile_image_url(self, obj):
        """
        Return the profile image URL only if the file actually exists on disk.
        On Render (ephemeral filesystem) uploaded files are lost on restart --
        returning a broken URL causes 404 log spam and broken avatar images.
        Falls back to None so the frontend can show a generated avatar instead.
        """
        if not obj.profile_image:
            return None
        try:
            if obj.profile_image.storage.exists(obj.profile_image.name):
                request = self.context.get('request')
                if request:
                    return request.build_absolute_uri(obj.profile_image.url)
                return obj.profile_image.url
        except Exception:
            pass
        return None


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
