"""
Views for Challenge API
"""
from django.conf import settings as django_settings
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.utils import timezone
from django.db.models import Q, Count, Avg, Max, Min
from django_filters.rest_framework import DjangoFilterBackend
from datetime import datetime, timezone as dt_timezone

from .models import Challenge, ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity, ImageInterpretationSubmission
from .serializers import (
    ChallengeSerializer, ChallengeCreateSerializer,
    ChallengeSubmissionSerializer,
    ChallengeSubmissionCreateSerializer, ChallengeLeaderboardSerializer,
    ChallengeActivitySerializer,
    ImageInterpretationSubmissionSerializer,
    ImageInterpretationSubmissionCreateSerializer,
)


def _use_fs_challenges():
    return django_settings.FIRESTORE_COLLECTIONS.get('challenges', False)


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

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    # ── create ────────────────────────────────────────────────────────────────

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if _use_fs_challenges():
            return self._create_firestore(request, serializer)

        challenge = serializer.save()
        output    = ChallengeSerializer(challenge, context={'request': request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    def _create_firestore(self, request, serializer):
        """Save a new challenge to Firestore."""
        import os
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        from .firestore_challenge_service import create_challenge

        image_file = serializer.validated_data.pop('image', None)
        if not image_file:
            return Response({'error': 'Image is required.'}, status=status.HTTP_400_BAD_REQUEST)

        ext       = os.path.splitext(image_file.name)[1].lower()
        safe_name = f"challenges/{serializer.validated_data['title'][:40].replace(' ', '_')}{ext}"
        path      = default_storage.save(safe_name, ContentFile(image_file.read()))
        image_url = (request.build_absolute_uri(default_storage.url(path))
                     if request else default_storage.url(path))

        doc = create_challenge(serializer.validated_data, image_url, request.user)
        if doc is None:
            return Response({'error': 'Failed to save challenge.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(doc, status=status.HTTP_201_CREATED)

    # ── retrieve (single challenge) ───────────────────────────────────────────

    def retrieve(self, request, *args, **kwargs):
        if _use_fs_challenges():
            from .firestore_challenge_service import get_challenge
            doc = get_challenge(kwargs.get('pk'), user=request.user)
            if doc is None:
                return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(doc)
        return super().retrieve(request, *args, **kwargs)

    # ── list ──────────────────────────────────────────────────────────────────

    def get_queryset(self):
        queryset = Challenge.objects.all()
        status_filter = self.request.query_params.get('status', None)
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        if self.request.query_params.get('active', False):
            now = timezone.now()
            queryset = queryset.filter(
                status='active', starts_at__lte=now, ends_at__gte=now
            )
        return queryset.select_related('created_by').prefetch_related('submissions')

    # ── custom list actions ───────────────────────────────────────────────────

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def active(self, request):
        """Get all active challenges."""
        if _use_fs_challenges():
            from .firestore_challenge_service import get_active_challenges
            return Response(get_active_challenges(user=request.user))

        now = timezone.now()
        challenges = Challenge.objects.filter(
            status='active', starts_at__lte=now, ends_at__gte=now
        ).order_by('-created_at')
        return Response(self.get_serializer(challenges, many=True).data)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def featured(self, request):
        """Get featured challenges."""
        if _use_fs_challenges():
            from .firestore_challenge_service import get_featured_challenges
            return Response(get_featured_challenges(user=request.user))

        challenges = Challenge.objects.filter(
            is_featured=True, status='active'
        ).order_by('-created_at')
        return Response(self.get_serializer(challenges, many=True).data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def following(self, request):
        """Active challenges from users the current user follows."""
        if _use_fs_challenges():
            from social.models import Follow
            from .firestore_challenge_service import get_following_challenges
            followed = list(Follow.objects.filter(
                follower=request.user
            ).values_list('following_id', flat=True))
            return Response(get_following_challenges(followed, user=request.user))

        from social.models import Follow
        now = timezone.now()
        followed_ids = Follow.objects.filter(
            follower=request.user
        ).values_list('following_id', flat=True)
        challenges = Challenge.objects.filter(
            created_by__in=followed_ids, status='active',
            starts_at__lte=now, ends_at__gte=now,
        ).select_related('created_by').prefetch_related('submissions').order_by('-created_at')
        return Response(self.get_serializer(challenges, many=True).data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_challenges(self, request):
        """All challenges created by the current user."""
        if _use_fs_challenges():
            from .firestore_challenge_service import get_challenges_by_creator
            return Response(get_challenges_by_creator(request.user.id, user=request.user))

        challenges = Challenge.objects.filter(
            created_by=request.user
        ).order_by('-created_at')
        return Response(self.get_serializer(challenges, many=True).data)

    # ── detail actions ────────────────────────────────────────────────────────

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def leaderboard(self, request, pk=None):
        """Get challenge leaderboard (always from PostgreSQL for now)."""
        challenge  = self.get_object()
        leaderboard, _ = ChallengeLeaderboard.objects.get_or_create(challenge=challenge)
        leaderboard.update_leaderboard()
        return Response(ChallengeLeaderboardSerializer(leaderboard).data)

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def activity(self, request, pk=None):
        """Get real-time activity for a challenge."""
        challenge = self.get_object()
        if django_settings.FIRESTORE_COLLECTIONS.get('challenge_activities', False):
            from .firestore_activity_service import get_challenge_activity
            return Response(get_challenge_activity(challenge.id, limit=50))
        activities = challenge.activities.all()[:50]
        return Response(ChallengeActivitySerializer(activities, many=True).data)

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def publish(self, request, pk=None):
        """Activate a draft/paused challenge."""
        if _use_fs_challenges():
            return self._publish_firestore(request, pk)

        challenge = self.get_object()
        if challenge.created_by != request.user:
            return Response({'error': 'Only the creator can publish this challenge.'},
                            status=status.HTTP_403_FORBIDDEN)
        if challenge.status == 'ended':
            return Response({'error': 'An ended challenge cannot be re-published.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if challenge.status == 'active':
            return Response({'message': 'Challenge is already active.'})
        now = timezone.now()
        if challenge.starts_at < now:
            challenge.starts_at = now
        challenge.status = 'active'
        challenge.save(update_fields=['status', 'starts_at'])
        return Response({'message': 'Challenge is now live!',
                         'challenge': self.get_serializer(challenge).data})

    def _publish_firestore(self, request, challenge_id):
        from .firestore_challenge_service import get_challenge, update_challenge_status
        doc = get_challenge(challenge_id)
        if doc is None:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if doc.get('created_by_id') != str(request.user.id):
            return Response({'error': 'Only the creator can publish this challenge.'},
                            status=status.HTTP_403_FORBIDDEN)
        if doc.get('status') == 'ended':
            return Response({'error': 'An ended challenge cannot be re-published.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if doc.get('status') == 'active':
            return Response({'message': 'Challenge is already active.'})

        extra = {}
        now    = datetime.now(tz=dt_timezone.utc)
        starts = doc.get('starts_at')
        if isinstance(starts, str):
            try:
                starts_dt = datetime.fromisoformat(starts)
                if starts_dt.tzinfo is None:
                    starts_dt = starts_dt.replace(tzinfo=dt_timezone.utc)
                if starts_dt < now:
                    extra['starts_at'] = now
            except ValueError:
                extra['starts_at'] = now
        updated = update_challenge_status(challenge_id, 'active', extra_fields=extra)
        return Response({'message': 'Challenge is now live!', 'challenge': updated})

    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def unpublish(self, request, pk=None):
        """Pause a live challenge."""
        if _use_fs_challenges():
            return self._unpublish_firestore(request, pk)

        challenge = self.get_object()
        if challenge.created_by != request.user:
            return Response({'error': 'Only the creator can unpublish this challenge.'},
                            status=status.HTTP_403_FORBIDDEN)
        if challenge.status not in ('active', 'paused'):
            return Response({'error': f'Cannot unpublish a "{challenge.status}" challenge.'},
                            status=status.HTTP_400_BAD_REQUEST)
        challenge.status = 'paused'
        challenge.save(update_fields=['status'])
        return Response({'message': 'Challenge paused.',
                         'challenge': self.get_serializer(challenge).data})

    def _unpublish_firestore(self, request, challenge_id):
        from .firestore_challenge_service import get_challenge, update_challenge_status
        doc = get_challenge(challenge_id)
        if doc is None:
            return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        if doc.get('created_by_id') != str(request.user.id):
            return Response({'error': 'Only the creator can unpublish this challenge.'},
                            status=status.HTTP_403_FORBIDDEN)
        if doc.get('status') not in ('active', 'paused'):
            return Response({'error': f'Cannot unpublish a "{doc.get("status")}" challenge.'},
                            status=status.HTTP_400_BAD_REQUEST)
        updated = update_challenge_status(challenge_id, 'paused')
        return Response({'message': 'Challenge paused.', 'challenge': updated})

    @action(detail=True, methods=['get'], permission_classes=[AllowAny])
    def stats(self, request, pk=None):
        """Get challenge statistics (always from PostgreSQL for now)."""
        challenge   = self.get_object()
        submissions = challenge.submissions.filter(status='scored')
        return Response({
            'total_submissions':   challenge.submission_count,
            'unique_participants': challenge.submissions.values('user').distinct().count(),
            'average_score':       submissions.aggregate(Avg('final_score'))['final_score__avg'] or 0,
            'highest_score':       submissions.aggregate(Max('final_score'))['final_score__max'] or 0,
            'lowest_score':        submissions.aggregate(Min('final_score'))['final_score__min'] or 0,
            'time_remaining':      challenge.time_remaining,
            'is_active':           challenge.is_active,
        })


class ChallengeSubmissionViewSet(viewsets.ModelViewSet):
    """ViewSet for ChallengeSubmission model"""

    queryset = ChallengeSubmission.objects.all()
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['challenge', 'status']
    ordering_fields = ['submitted_at', 'final_score']
    ordering = ['-submitted_at']

    @staticmethod
    def _use_fs():
        return django_settings.FIRESTORE_COLLECTIONS.get('submissions', False)

    def get_queryset(self):
        return ChallengeSubmission.objects.filter(
            user=self.request.user
        ).select_related('challenge', 'user')

    def get_serializer_class(self):
        if self.action == 'create':
            return ChallengeSubmissionCreateSerializer
        return ChallengeSubmissionSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        submission = serializer.instance

        if self._use_fs():
            # serializer already wrote to Firestore; instance is a dict
            return Response(submission, status=status.HTTP_201_CREATED)

        output_serializer = ChallengeSubmissionSerializer(submission)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_submissions(self, request):
        """Get current user's submissions."""
        if self._use_fs():
            from .firestore_submission_service import get_my_submissions
            return Response(get_my_submissions(request.user))

        submissions = self.get_queryset()
        return Response(self.get_serializer(submissions, many=True).data)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def challenge_submissions(self, request):
        """Get all scored submissions for a specific challenge."""
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response({'error': 'challenge_id parameter required'},
                            status=status.HTTP_400_BAD_REQUEST)

        if self._use_fs():
            from .firestore_submission_service import get_challenge_submissions
            return Response(get_challenge_submissions(challenge_id))

        submissions = ChallengeSubmission.objects.filter(
            challenge_id=challenge_id, status='scored'
        ).select_related('user').order_by('-final_score')[:100]
        return Response(self.get_serializer(submissions, many=True).data)


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

    @staticmethod
    def _use_firestore():
        from django.conf import settings
        return settings.FIRESTORE_COLLECTIONS.get('challenge_activities', False)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def challenge_activity(self, request):
        """Get real-time activity for a challenge"""
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response(
                {'error': 'challenge_id parameter required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if self._use_firestore():
            from .firestore_activity_service import get_challenge_activity
            data = get_challenge_activity(challenge_id, limit=50)
            return Response(data)

        activities = ChallengeActivity.objects.filter(
            challenge_id=challenge_id
        ).select_related('user', 'challenge').order_by('-created_at')[:50]
        serializer = self.get_serializer(activities, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def global_activity(self, request):
        """Get global activity feed"""
        if self._use_firestore():
            from .firestore_activity_service import get_global_activity
            data = get_global_activity(limit=100)
            return Response(data)

        activities = ChallengeActivity.objects.select_related(
            'user', 'challenge'
        ).order_by('-created_at')[:100]
        serializer = self.get_serializer(activities, many=True)
        return Response(serializer.data)


class ImageInterpretationViewSet(viewsets.ModelViewSet):
    """ViewSet for Image Interpretation submissions."""

    permission_classes = [IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields   = ['challenge', 'status']
    ordering_fields    = ['submitted_at', 'final_score']
    ordering           = ['-submitted_at']

    @staticmethod
    def _use_fs():
        return django_settings.FIRESTORE_COLLECTIONS.get('submissions', False)

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
        instance = serializer.instance

        if self._use_fs():
            return Response(instance, status=status.HTTP_201_CREATED)

        output = ImageInterpretationSubmissionSerializer(
            instance, context={'request': request}
        )
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my(self, request):
        """All image interpretation submissions for the current user."""
        if self._use_fs():
            from .firestore_submission_service import get_my_submissions
            data = [s for s in get_my_submissions(request.user)
                    if s.get('submission_type') == 'image']
            return Response(data)

        subs = self.get_queryset()
        return Response(ImageInterpretationSubmissionSerializer(
            subs, many=True, context={'request': request}
        ).data)

    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def leaderboard(self, request):
        """Top scorers for a specific image interpretation challenge."""
        challenge_id = request.query_params.get('challenge_id')
        if not challenge_id:
            return Response({'error': 'challenge_id is required'},
                            status=status.HTTP_400_BAD_REQUEST)

        if self._use_fs():
            from .firestore_submission_service import get_leaderboard, get_challenge_submissions
            top = get_leaderboard(challenge_id, submission_type='image', limit=20)
            all_scored = get_challenge_submissions(challenge_id, status_filter='scored')
            img_scored = [s for s in all_scored if s.get('submission_type') == 'image']
            avg = (sum(s['final_score'] for s in img_scored) / len(img_scored)
                   if img_scored else 0.0)
            return Response({
                'challenge_id':       challenge_id,
                'total_participants': len(img_scored),
                'average_score':      round(avg, 1),
                'top_submissions':    top,
            })

        try:
            challenge = Challenge.objects.get(
                pk=challenge_id, challenge_type='image_interpretation'
            )
        except Challenge.DoesNotExist:
            return Response({'error': 'Challenge not found'},
                            status=status.HTTP_404_NOT_FOUND)

        top = (
            ImageInterpretationSubmission.objects
            .filter(challenge=challenge, status='scored')
            .select_related('user')
            .order_by('-final_score')[:20]
        )
        leaderboard_data = [
            {
                'rank':                 idx + 1,
                'user_id':             str(sub.user.id),
                'username':            sub.user.username,
                'final_score':         sub.final_score,
                'observation_score':   sub.observation_score,
                'interpretation_score': sub.interpretation_score,
                'matched_count':       0,
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
            avg    = sum(scores) / len(scores)

        return Response({
            'challenge_id':       str(challenge.id),
            'challenge_title':    challenge.title,
            'total_participants': all_scored.count(),
            'average_score':      round(avg, 1),
            'top_submissions':    leaderboard_data,
        })
