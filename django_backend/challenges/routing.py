"""
WebSocket URL routing for the challenges app.
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(
        r"^ws/challenges/(?P<challenge_id>[0-9a-f-]+)/$",
        consumers.ChallengeConsumer.as_asgi(),
    ),
    re_path(
        r"^ws/debate/(?P<debate_id>[0-9a-f-]+)/$",
        consumers.DebateConsumer.as_asgi(),
    ),
    re_path(
        r"^ws/qa/(?P<qa_id>[0-9a-f-]+)/$",
        consumers.QAConsumer.as_asgi(),
    ),
]
