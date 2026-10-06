"""
ASGI config for PAGE Platform

Handles HTTP (via Django + WhiteNoise async), WebSocket (via Django Channels).

WhiteNoise is configured via WhiteNoiseMiddleware in settings.MIDDLEWARE —
do NOT wrap the ASGI app with whitenoise.WhiteNoise directly here, as that
class is WSGI-only and its __call__ signature is incompatible with the
(scope, receive, send) ASGI protocol used by Channels/uvicorn.

The "StreamingHttpResponse must consume synchronous iterators" warning comes
from WhiteNoise serving static files through the async ASGI path.  It is a
warning only — static files are served correctly.  It is suppressed below
because there is no clean fix without replacing WhiteNoise with an async-
native static file server (e.g. starlette.staticfiles), which is out of scope.
"""
import os
import warnings

# Suppress the WhiteNoise/static-file streaming warning — it's cosmetic only
warnings.filterwarnings(
    'ignore',
    message='StreamingHttpResponse must consume synchronous iterators',
    category=Warning,
)

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
