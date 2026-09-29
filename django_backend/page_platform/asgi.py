"""
ASGI config for PAGE Platform

Handles HTTP (via Django + WhiteNoise async), WebSocket (via Django Channels).

WhiteNoise is configured via WhiteNoiseMiddleware in settings.MIDDLEWARE —
do NOT wrap the ASGI app with whitenoise.WhiteNoise directly here, as that
class is WSGI-only and its __call__ signature is incompatible with the
(scope, receive, send) ASGI protocol used by Channels/uvicorn.
"""
import os

from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'page_platform.settings')

# Initialise Django before importing anything that touches models or settings
django_asgi_app = get_asgi_application()

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
