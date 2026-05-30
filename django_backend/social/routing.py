"""
WebSocket routing for social features
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/social/feed/$', consumers.SocialFeedConsumer.as_asgi()),
    re_path(r'ws/social/notifications/$', consumers.NotificationConsumer.as_asgi()),
]
