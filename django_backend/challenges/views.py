"""
Views for Challenge API
"""
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.utils import timezone
from django.db.models import Q, Count, Avg, Max, Min
from django_filters.rest_framework import DjangoFilterBackend

from .models import Challenge, ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity, ImageInterpretationSubmission
from .serializers import (
    ChallengeSerializer, ChallengeCreateSerializer,
    ChallengeSubmissionSerializer,
    ChallengeSubmissionCreateSerializer, ChallengeLeaderboardSerializer,
    ChallengeActivitySerializer,
    ImageInterpretationSubmissionSerializer,
    ImageInterpretationSubmissionCreateSerializer,
)


class ChallengeViewSet(viewsets.ModelViewSet):
    """ViewSet for Challenge model"""
    
    queryset = Challenge.objects.all()
    serializer_class = ChallengeSerializer
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['difficulty', 'status']
    search_fields = ['title', 'description']
    ordering_fields = ['created_at', 'ends_at', 'submission_count']
    ordering = ['-created_at']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAuthenticated()]
        return [AllowAny()]

    def get_serializer_class(self):
        if self.action == 'create':
            return ChallengeCreateSerializer
        return ChallengeSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        challenge = serializer.save()
        output = ChallengeSerializer(challenge, context={'request': request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def following(self, request):
        """
        Return active challenges created by users that the current user follows.
        Requires authentication.
        """
        from social.models import Follow
        now = timezone.now()

        # IDs of users the current user follows
        followed_ids = Follow.objects.filter(
            follower=request.user
        ).values_list('following_id', flat=True)

        challenges = Challenge.objects.filter(
            created_by__in=followed_ids,
            status='active',
            starts_at__lte=now,
            ends_at__gte=now,
        ).select_related('created_by').prefetch_related('submissions').order_by('-created_at')

        serializer = self.get_serializer(challenges, many=True)
        return Response(serializer.data)
    
    def get_queryset(self):
        """Filter challenges based on status"""
        queryset = Challenge.objects.all()
        
        # Filter by status
        status_filter = self.request.query_params.get('status', None)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Filter active challenges
        if self.request.query_params.get('active', False):
            now = timezone.now()
            queryset = queryset.filter(
                status='active',
                starts_at__lte=now,
                ends_at__gte=now
            )
        
        return queryset.select_related('created_by').prefetch_related('submissions')
    
    def get_serializer_context(self):
        """Add request to serializer context"""
        context = super().get_serializer_context()
        context['request'] = self.request
        return context
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def active(self, request):
        """Get all active challenges"""
        now = timezone.now()
        challenges = Challenge.objects.filter(
            status='active',
            starts_at__lte=now,
            ends_at__gte=now
        ).order_by('-created_at')
        
        serializer = self.get_serializer(challenges, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def featured(self, request):
        """Get featured challenges"""
        challenges = Challenge.objects.filter(
            is_featured=True,
            status='active'
        ).order_by('-created_at')
        
        serializer = self.get_serializer(challenges, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def leaderboard(self, request, pk=None):
        """Get challenge leaderboard"""
        challenge = self.get_object()
        leaderboard, created = ChallengeLeaderboard.objects.get_or_create(challenge=challenge)
        leaderboard.update_leaderboard()
        
        serializer = ChallengeLeaderboardSerializer(leaderboard)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def activity(self, request, pk=None):
        """Get real-time activity for a challenge"""
        challenge = self.get_object()
        activities = challenge.activities.all()[:50]  # Last 50 activities
        
        serializer = ChallengeActivitySerializer(activities, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_challenges(self, request):
        """Return all challenges created by the current user (any status)."""
        challenges = Challenge.objects.filter(
            created_by=request.user
        ).order_by('-created_at')
        serializer = self.get_serializer(challenges, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def publish(self, request, pk=None):
        """
        Activate a draft/paused challenge.
        Only the challenge creator can call this.
        """
        challenge = self.get_object()
        if challenge.created_by != request.user:
            return Response(
                {'error': 'Only the creator of this challenge can publish it.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if challenge.status == 'ended':
            return Response(
                {'error': 'An ended challenge cannot be re-published.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if challenge.status == 'active':
            return Response(
                {'message': 'Challenge is already active.'},
                status=status.HTTP_200_OK,
            )
        # Ensure starts_at is set to now if it's in the past
        now = timezone.now()
        if challenge.starts_at < now:
            challenge.starts_at = now
        challenge.status = 'active'
        challenge.save(update_fields=['status', 'starts_at'])
        serializer = self.get_serializer(challenge)
        return Response({'message': 'Challenge is now live!', 'challenge': serializer.data})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def unpublish(self, request, pk=None):
        """
        Pause or end a live challenge.
        Only the challenge creator can call this.
        """
        challenge = self.get_object()
        if challenge.created_by != request.user:
            return Response(
                {'error': 'Only the creator of this challenge can unpublish it.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if challenge.status not in ('active', 'paused'):
            return Response(
                {'error': f'Cannot unpublish a challenge with status "{challenge.status}".'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        challenge.status = 'paused'
        challenge.save(update_fields=['status'])
        serializer = self.get_serializer(challenge)
        return Response({'message': 'Challenge paused.', 'challenge': serializer.data})

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def stats(self, request, pk=None):
        """Get challenge statistics"""
        challenge = self.get_object()
        submissions = challenge.submissions.filter(status='scored')
        
        stats = {
            'total_submissions': challenge.submission_count,
            'unique_participants': challenge.submissions.values('user').distinct().count(),
            'average_score': submissions.aggregate(Avg('final_score'))['final_score__avg'] or 0,
            'highest_score': submissions.aggregate(Max('final_score'))['final_score__max'] or 0,
            'lowest_score': submissions.aggregate(Min('final_score'))['final_score__min'] or 0,
            'time_remaining': challenge.time_remaining,
            'is_active': challenge.is_active,
        }
        
        return Response(stats)


class ChallengeSubmissionViewSet(viewsets.ModelViewSet):
    """ViewSet for ChallengeSubmission model"""
    
    queryset = ChallengeSubmission.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['challenge', 'status']
    ordering_fields = ['submitted_at', 'final_score']
    ordering = ['-submitted_at']
    
    def get_queryset(self):
        """Filter submissions for current user"""
        return ChallengeSubmission.objects.filter(
            user=self.request.user
        ).select_related('challenge', 'user')
    
    def get_serializer_class(self):
        """Use different serializer for create action"""
        if self.action == 'create':
            return ChallengeSubmissionCreateSerializer
        return ChallengeSubmissionSerializer
    
    def create(self, request, *args, **kwargs):
        """Create a new submission"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        
        # Return full submission details
        submission = serializer.instance
        output_serializer = ChallengeSubmissionSerializer(submission)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_submissions(self, request):
        """Get current user's submissions"""
        submissions = self.get_queryset()
        serializer = self.get_serializer(submissions, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def challenge_submissions(self, request):
        """Get all submissions for a specific challenge"""
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response(
                {'error': 'challenge_id parameter required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        submissions = ChallengeSubmission.objects.filter(
            challenge_id=challenge_id,
            status='scored'
        ).select_related('user').order_by('-final_score')[:100]
        
        serializer = self.get_serializer(submissions, many=True)
        return Response(serializer.data)


class ChallengeLeaderboardViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for ChallengeLeaderboard model"""
    
    queryset = ChallengeLeaderboard.objects.all()
    serializer_class = ChallengeLeaderboardSerializer
    permission_classes = [AllowAny]
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def global_leaderboard(self, request):
        """Get global leaderboard across all challenges"""
        # Get top users by prestige
        from users.models import User
        top_users = User.objects.filter(
            is_active=True
        ).order_by('-prestige_points')[:100]
        
        leaderboard_data = [
            {
                'rank': idx + 1,
                'user_id': str(user.id),
                'username': user.username,
                'prestige_points': user.prestige_points,
                'access_tier': user.access_tier,
                'level': user.level,
                'total_submissions': user.total_submissions,
                'success_rate': user.success_rate,
            }
            for idx, user in enumerate(top_users)
        ]
        
        return Response(leaderboard_data)


class ChallengeActivityViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet for ChallengeActivity model"""
    
    queryset = ChallengeActivity.objects.all()
    serializer_class = ChallengeActivitySerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['challenge', 'activity_type']
    ordering_fields = ['created_at']
    ordering = ['-created_at']
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def challenge_activity(self, request):
        """Get real-time activity for a challenge"""
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response(
                {'error': 'challenge_id parameter required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        activities = ChallengeActivity.objects.filter(
            challenge_id=challenge_id
        ).select_related('user', 'challenge').order_by('-created_at')[:50]
        
        serializer = self.get_serializer(activities, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def global_activity(self, request):
        """Get global activity feed"""
        activities = ChallengeActivity.objects.select_related(
            'user', 'challenge'
        ).order_by('-created_at')[:100]
        
        serializer = self.get_serializer(activities, many=True)
        return Response(serializer.data)


class ImageInterpretationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Image Interpretation submissions.

    POST   /api/challenges/image-submissions/         — submit an attempt
    GET    /api/challenges/image-submissions/          — list own submissions
    GET    /api/challenges/image-submissions/{id}/     — single submission detail
    GET    /api/challenges/image-submissions/my/       — alias for own submissions
    GET    /api/challenges/image-submissions/leaderboard/?challenge_id=<id>
    """

    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields   = ['challenge', 'status']
    ordering_fields    = ['submitted_at', 'final_score']
    ordering           = ['-submitted_at']

    def get_queryset(self):
        return ImageInterpretationSubmission.objects.filter(
            user=self.request.user
        ).select_related('challenge', 'user')

    def get_serializer_class(self):
        if self.action == 'create':
            return ImageInterpretationSubmissionCreateSerializer
        return ImageInterpretationSubmissionSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        output = ImageInterpretationSubmissionSerializer(
            serializer.instance, context={'request': request}
        )
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my(self, request):
        """All image interpretation submissions for the current user."""
        subs = self.get_queryset()
        serializer = ImageInterpretationSubmissionSerializer(subs, many=True, context={'request': request})
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def leaderboard(self, request):
        """
        Top scorers for a specific image interpretation challenge.
        Query param: challenge_id (required)
        """
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response({'error': 'challenge_id is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            challenge = Challenge.objects.get(pk=challenge_id, challenge_type='image_interpretation')
        except Challenge.DoesNotExist:
            return Response({'error': 'Challenge not found'}, status=status.HTTP_404_NOT_FOUND)

        top = (
            ImageInterpretationSubmission.objects
            .filter(challenge=challenge, status='scored')
            .select_related('user')
            .order_by('-final_score')[:20]
        )

        leaderboard_data = [
            {
                'rank':                idx + 1,
                'user_id':             str(sub.user.id),
                'username':            sub.user.username,
                'final_score':         sub.final_score,
                'observation_score':   sub.observation_score,
                'interpretation_score': sub.interpretation_score,
                'matched_count':       0,   # hidden from leaderboard
                'submitted_at':        sub.submitted_at.isoformat(),
            }
            for idx, sub in enumerate(top)
        ]

        all_scored = ImageInterpretationSubmission.objects.filter(
            challenge=challenge, status='scored'
        )
        avg = 0.0
        if all_scored.exists():
            scores = list(all_scored.values_list('final_score', flat=True))
            avg = sum(scores) / len(scores)

        return Response({
            'challenge_id':       str(challenge.id),
            'challenge_title':    challenge.title,
            'total_participants': all_scored.count(),
            'average_score':      round(avg, 1),
            'top_submissions':    leaderboard_data,
        })
