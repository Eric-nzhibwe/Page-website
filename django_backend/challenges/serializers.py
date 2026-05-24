"""
Serializers for Challenge models
"""
from rest_framework import serializers
from .models import Challenge, ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity
from users.serializers import UserProfileSerializer


class ChallengeSerializer(serializers.ModelSerializer):
    """Serializer for Challenge model"""
    
    is_active = serializers.SerializerMethodField()
    time_remaining = serializers.SerializerMethodField()
    has_started = serializers.SerializerMethodField()
    has_ended = serializers.SerializerMethodField()
    user_has_submitted = serializers.SerializerMethodField()
    
    class Meta:
        model = Challenge
        fields = [
            'id', 'title', 'description', 'image_url', 'difficulty',
            'time_limit', 'min_word_count', 'max_word_count',
            'submission_rules', 'creativity_weight', 'relevance_weight',
            'detail_weight', 'min_points', 'max_points', 'status',
            'starts_at', 'ends_at', 'is_featured', 'view_count',
            'submission_count', 'is_active', 'time_remaining',
            'has_started', 'has_ended', 'user_has_submitted',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'view_count', 'submission_count']
    
    def get_is_active(self, obj):
        return obj.is_active
    
    def get_time_remaining(self, obj):
        return obj.time_remaining
    
    def get_has_started(self, obj):
        return obj.has_started
    
    def get_has_ended(self, obj):
        return obj.has_ended
    
    def get_user_has_submitted(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.submissions.filter(user=request.user).exists()
        return False


class ChallengeSubmissionSerializer(serializers.ModelSerializer):
    """Serializer for ChallengeSubmission model"""
    
    user = UserProfileSerializer(read_only=True)
    challenge_title = serializers.CharField(source='challenge.title', read_only=True)
    
    class Meta:
        model = ChallengeSubmission
        fields = [
            'id', 'challenge', 'challenge_title', 'user', 'interpretation',
            'word_count', 'status', 'creativity_score', 'relevance_score',
            'detail_score', 'final_score', 'submitted_at', 'scored_at',
            'submission_time_seconds'
        ]
        read_only_fields = [
            'id', 'status', 'creativity_score', 'relevance_score',
            'detail_score', 'final_score', 'submitted_at', 'scored_at'
        ]


class ChallengeSubmissionCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating challenge submissions"""
    
    class Meta:
        model = ChallengeSubmission
        fields = ['challenge', 'interpretation', 'submission_time_seconds']
    
    def validate_interpretation(self, value):
        """Validate interpretation text"""
        if not value or not value.strip():
            raise serializers.ValidationError("Interpretation cannot be empty")
        return value
    
    def validate(self, data):
        """Validate submission against challenge requirements"""
        challenge = data['challenge']
        interpretation = data['interpretation']
        
        # Check if challenge is active
        if not challenge.is_active:
            raise serializers.ValidationError("This challenge is not currently active")
        
        # Check if user already submitted
        user = self.context['request'].user
        if challenge.submissions.filter(user=user).exists():
            raise serializers.ValidationError("You have already submitted to this challenge")
        
        # Count words
        words = interpretation.strip().split()
        word_count = len(words)
        
        # Validate word count
        if word_count < challenge.min_word_count:
            raise serializers.ValidationError(
                f"Interpretation is too short. Minimum {challenge.min_word_count} words required, got {word_count}"
            )
        
        if word_count > challenge.max_word_count:
            raise serializers.ValidationError(
                f"Interpretation is too long. Maximum {challenge.max_word_count} words allowed, got {word_count}"
            )
        
        data['word_count'] = word_count
        return data
    
    def create(self, validated_data):
        """Create submission and record activity"""
        user = self.context['request'].user
        submission = ChallengeSubmission.objects.create(
            user=user,
            **validated_data
        )
        
        # Create activity record
        ChallengeActivity.objects.create(
            challenge=submission.challenge,
            user=user,
            activity_type='submission',
            description=f"{user.username} submitted to {submission.challenge.title}",
            metadata={
                'submission_id': str(submission.id),
                'word_count': submission.word_count
            }
        )
        
        return submission


class ChallengeLeaderboardSerializer(serializers.ModelSerializer):
    """Serializer for ChallengeLeaderboard model"""
    
    challenge_title = serializers.CharField(source='challenge.title', read_only=True)
    
    class Meta:
        model = ChallengeLeaderboard
        fields = [
            'id', 'challenge', 'challenge_title', 'top_submissions',
            'total_participants', 'average_score', 'highest_score',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ChallengeActivitySerializer(serializers.ModelSerializer):
    """Serializer for ChallengeActivity model"""
    
    user = UserProfileSerializer(read_only=True)
    challenge_title = serializers.CharField(source='challenge.title', read_only=True)
    
    class Meta:
        model = ChallengeActivity
        fields = [
            'id', 'challenge', 'challenge_title', 'user', 'activity_type',
            'description', 'metadata', 'created_at'
        ]
        read_only_fields = ['id', 'created_at'] 
