"""
ASGI config for PAGE Platform

Handles both HTTP (via Django) and WebSocket (via Django Channels) connections.
"""
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'page_platform.settings')

# Initialize Django ASGI application early to ensure the AppRegistry is ready
# before importing consumers that reference models.
django_asgi_app = get_asgi_application()

# Import WebSocket URL patterns from each app after Django is ready
from notifications.routing import websocket_urlpatterns as notifications_ws
from social.routing import websocket_urlpatterns as social_ws
from challenges.routing import websocket_urlpatterns as challenges_ws

# Messenger uses Firestore real-time listeners instead of Django Channels WebSockets
# so it has no consumers.py or routing.py

all_websocket_urlpatterns = (
    notifications_ws
    + social_ws
    + challenges_ws
)

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': AuthMiddlewareStack(
        URLRouter(all_websocket_urlpatterns)
    ),
})
