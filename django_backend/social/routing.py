"""
WebSocket routing for social features
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/social/posts/(?P<post_id>[^/]+)/$', consumers.PostConsumer.as_asgi()),
    re_path(r'ws/social/stories/$', consumers.StoryConsumer.as_asgi()),
]
