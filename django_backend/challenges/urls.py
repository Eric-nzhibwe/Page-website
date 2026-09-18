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
from .social_views import (
    xpoints_balance,
    poll_list, create_poll, cast_poll_vote,
    debate_list, create_debate, join_debate, post_debate_comment,
    qa_list, create_qa, post_qa_answer,
)

router = DefaultRouter()
router.register(r'', ChallengeViewSet, basename='challenge')
router.register(r'submissions', ChallengeSubmissionViewSet, basename='submission')
router.register(r'leaderboards', ChallengeLeaderboardViewSet, basename='leaderboard')
router.register(r'activities', ChallengeActivityViewSet, basename='activity')
router.register(r'image-submissions', ImageInterpretationViewSet, basename='image-submission')

urlpatterns = [
    # ── Social challenge endpoints ─────────────────────────────────────────
    path('xpoints/',                          xpoints_balance,       name='xpoints-balance'),
    # Polls
    path('polls/',                            poll_list,             name='poll-list'),
    path('polls/create/',                     create_poll,           name='poll-create'),
    path('polls/<uuid:poll_id>/vote/',        cast_poll_vote,        name='poll-vote'),
    # Debates
    path('debates/',                          debate_list,           name='debate-list'),
    path('debates/create/',                   create_debate,         name='debate-create'),
    path('debates/<uuid:debate_id>/join/',    join_debate,           name='debate-join'),
    path('debates/<uuid:debate_id>/comment/', post_debate_comment,   name='debate-comment'),
    # Q&A
    path('qa/',                               qa_list,               name='qa-list'),
    path('qa/create/',                        create_qa,             name='qa-create'),
    path('qa/<uuid:qa_id>/answer/',           post_qa_answer,        name='qa-answer'),
    # ── Standard DRF router ───────────────────────────────────────────────
    path('', include(router.urls)),
]
