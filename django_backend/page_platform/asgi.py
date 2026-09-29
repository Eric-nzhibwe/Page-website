"""
ASGI config for PAGE Platform

Handles HTTP (via Django + WhiteNoise async), WebSocket (via Django Channels).

WhiteNoise is wrapped around the Django ASGI app directly here so it serves
static files via an async iterator — eliminating the
"StreamingHttpResponse must consume synchronous iterators" warning that
occurs when WhiteNoiseMiddleware runs inside uvicorn's async context.
"""
import os
from pathlib import Path

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'page_platform.settings')

# Initialise Django before importing anything that touches models or settings
django_asgi_app = get_asgi_application()

# Wrap with WhiteNoise for async-safe static file serving
from whitenoise import WhiteNoise  # noqa: E402 — must come after django setup

BASE_DIR = Path(__file__).resolve().parent.parent
django_asgi_app = WhiteNoise(
    django_asgi_app,
    root=str(BASE_DIR / 'staticfiles'),
    prefix='static',
)

# Import WebSocket URL patterns after Django is ready
from notifications.routing import websocket_urlpatterns as notifications_ws  # noqa: E402
from social.routing import websocket_urlpatterns as social_ws                # noqa: E402
from challenges.routing import websocket_urlpatterns as challenges_ws        # noqa: E402

all_websocket_urlpatterns = (
    notifications_ws
    + social_ws
    + challenges_ws
)

application = ProtocolTypeRouter({
    'http':      django_asgi_app,
    'websocket': AuthMiddlewareStack(
        URLRouter(all_websocket_urlpatterns)
    ),
})
