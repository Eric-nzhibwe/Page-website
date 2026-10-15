"""
WebSocket routing for messenger
"""
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'^ws/messenger/$', consumers.MessengerConsumer.as_asgi()),
]
