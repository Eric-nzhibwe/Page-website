"""
URLs for Challenge API
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ChallengeViewSet, ChallengeSubmissionViewSet,
    ChallengeLeaderboardViewSet, ChallengeActivityViewSet
)

router = DefaultRouter()
router.register(r'challenges', ChallengeViewSet, basename='challenge')
router.register(r'submissions', ChallengeSubmissionViewSet, basename='submission')
router.register(r'leaderboards', ChallengeLeaderboardViewSet, basename='leaderboard')
router.register(r'activities', ChallengeActivityViewSet, basename='activity')

urlpatterns = [
    path('', include(router.urls)),
]
