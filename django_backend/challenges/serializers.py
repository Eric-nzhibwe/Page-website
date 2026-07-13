"""
Serializers for Challenge models
"""
from rest_framework import serializers
from .models import Challenge, ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity, ImageInterpretationSubmission
from users.serializers import UserProfileSerializer


class ChallengeSerializer(serializers.ModelSerializer):
    """Serializer for Challenge model"""
    
    is_active = serializers.SerializerMethodField()
    time_remaining = serializers.SerializerMethodField()
    has_started = serializers.SerializerMethodField()
    has_ended = serializers.SerializerMethodField()
    user_has_submitted = serializers.SerializerMethodField()
    user_has_img_submitted = serializers.SerializerMethodField()
    created_by_username = serializers.SerializerMethodField()
    
    class Meta:
        model = Challenge
        fields = [
            'id', 'title', 'description', 'image_url', 'difficulty',
            'challenge_type', 'hidden_points', 'prize_amount', 'entry_fee',
            'time_limit', 'min_word_count', 'max_word_count',
            'submission_rules', 'creativity_weight', 'relevance_weight',
            'detail_weight', 'min_points', 'max_points', 'status',
            'starts_at', 'ends_at', 'is_featured', 'view_count',
            'submission_count', 'is_active', 'time_remaining',
            'has_started', 'has_ended', 'user_has_submitted',
            'user_has_img_submitted', 'created_by_username',
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

    def get_user_has_img_submitted(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.image_submissions.filter(user=request.user).exists()
        return False

    def get_created_by_username(self, obj):
        return obj.created_by.username if obj.created_by else None


class ImageInterpretationSubmissionSerializer(serializers.ModelSerializer):
    """Read serializer — returned after scoring"""
    user = UserProfileSerializer(read_only=True)
    challenge_title = serializers.CharField(source='challenge.title', read_only=True)
    point_results   = serializers.SerializerMethodField()

    class Meta:
        model  = ImageInterpretationSubmission
        fields = [
            'id', 'challenge', 'challenge_title', 'user',
            'discovered_points', 'overall_message',
            'submission_time_seconds', 'status',
            'observation_score', 'interpretation_score', 'final_score',
            'points_earned', 'prize_awarded',
            'ai_feedback', 'submitted_at', 'scored_at',
            'point_results',
        ]
        read_only_fields = [
            'id', 'status', 'observation_score', 'interpretation_score',
            'final_score', 'points_earned', 'prize_awarded',
            'ai_feedback', 'submitted_at', 'scored_at',
        ]

    def get_point_results(self, obj):
        """Parse point results from ai_feedback metadata if stored there."""
        import json
        try:
            meta = json.loads(obj.ai_feedback) if obj.ai_feedback.startswith('{') else {}
            return meta.get('point_results', [])
        except Exception:
            return []


class ImageInterpretationSubmissionCreateSerializer(serializers.ModelSerializer):
    """Write serializer — used when participant submits"""

    class Meta:
        model  = ImageInterpretationSubmission
        fields = ['challenge', 'discovered_points', 'overall_message', 'submission_time_seconds']

    def validate_discovered_points(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('discovered_points must be a list.')
        if len(value) == 0:
            raise serializers.ValidationError('You must identify at least one point.')
        for item in value:
            if not isinstance(item, dict):
                raise serializers.ValidationError('Each point must be an object with "label" and "interpretation".')
            if not item.get('label', '').strip():
                raise serializers.ValidationError('Each point must have a non-empty "label".')
            if not item.get('interpretation', '').strip():
                raise serializers.ValidationError('Each point must have a non-empty "interpretation".')
        return value

    def validate(self, data):
        challenge = data['challenge']

        # Must be an image interpretation challenge
        if challenge.challenge_type != 'image_interpretation':
            raise serializers.ValidationError(
                'This endpoint is only for image_interpretation challenges.'
            )

        # Must be active
        if not challenge.is_active:
            raise serializers.ValidationError('This challenge is not currently active.')

        # One submission per user
        user = self.context['request'].user
        if challenge.image_submissions.filter(user=user).exists():
            raise serializers.ValidationError('You have already submitted to this challenge.')

        return data

    def create(self, validated_data):
        from django.utils import timezone
        from .scoring_service import score_image_interpretation

        user       = self.context['request'].user
        challenge  = validated_data['challenge']
        discovered = validated_data['discovered_points']
        overall    = validated_data.get('overall_message', '')

        # Create submission first
        submission = ImageInterpretationSubmission.objects.create(
            user=user,
            status='scoring',
            **validated_data,
        )

        # Score immediately (synchronous — switch to Celery task for production scale)
        try:
            result = score_image_interpretation(
                hidden_points=challenge.hidden_points,
                discovered_points=discovered,
                overall_message=overall,
            )

            import json
            submission.observation_score    = result['observation_score']
            submission.interpretation_score = result['interpretation_score']
            submission._matched_count       = result['matched_count']

            # Store full result JSON in ai_feedback for point_results retrieval
            submission.ai_feedback = json.dumps({
                'summary':      result['ai_feedback'],
                'point_results': result.get('point_results', []),
            })

            submission.calculate_final_score()

            # Map final_score to prestige points
            submission.points_earned = submission.final_score
            submission.status        = 'scored'
            submission.scored_at     = timezone.now()
            submission.save()

            # Award prestige
            user.add_prestige(
                submission.points_earned,
                f'Image Interpretation — {challenge.title}',
            )

            # Record activity
            from .models import ChallengeActivity
            ChallengeActivity.objects.create(
                challenge=challenge,
                user=user,
                activity_type='submission',
                description=f"{user.username} submitted to {challenge.title} "
                            f"({result['matched_count']}/{result['total_points']} points found)",
                metadata={
                    'submission_id':      str(submission.id),
                    'observation_score':  result['observation_score'],
                    'matched_count':      result['matched_count'],
                },
            )

        except Exception as exc:
            import logging
            logging.getLogger(__name__).error(f'Scoring failed: {exc}')
            submission.status     = 'submitted'
            submission.ai_feedback = 'Scoring is pending — check back shortly.'
            submission.save(update_fields=['status', 'ai_feedback'])

        return submission


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
