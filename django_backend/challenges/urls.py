"""
URLs for Challenge API
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ChallengeViewSet, ChallengeSubmissionViewSet,
    ChallengeLeaderboardViewSet, ChallengeActivityViewSet,
    ImageInterpretationViewSet,
)

router = DefaultRouter()
router.register(r'', ChallengeViewSet, basename='challenge')
router.register(r'submissions', ChallengeSubmissionViewSet, basename='submission')
router.register(r'leaderboards', ChallengeLeaderboardViewSet, basename='leaderboard')
router.register(r'activities', ChallengeActivityViewSet, basename='activity')
router.register(r'image-submissions', ImageInterpretationViewSet, basename='image-submission')

urlpatterns = [
    path('', include(router.urls)),
]
