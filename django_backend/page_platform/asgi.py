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

Auth note: ALL consumers authenticate via ?token= query param (DRF Token auth)
handled inside each consumer's connect() method.  AuthMiddlewareStack is NOT
used here because it only understands Django session cookies, not DRF tokens.
Using it would add useless overhead and can break token-auth WS connections on
some Channels versions.
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

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'page_platform.settings')

# Initialise Django before importing anything that touches models or settings
django_asgi_app = get_asgi_application()

# Import WebSocket URL patterns after Django is ready
from notifications.routing import websocket_urlpatterns as notifications_ws  # noqa: E402
from social.routing import websocket_urlpatterns as social_ws                # noqa: E402
from challenges.routing import websocket_urlpatterns as challenges_ws        # noqa: E402
from messenger.routing import websocket_urlpatterns as messenger_ws          # noqa: E402

all_websocket_urlpatterns = (
    notifications_ws
    + social_ws
    + challenges_ws
    + messenger_ws
)


async def _lifespan_handler(scope, receive, send):
    """
    Minimal ASGI lifespan handler for uvicorn --lifespan on.
    Channels 4's ProtocolTypeRouter raises ValueError: 'No application
    configured for scope type lifespan' when uvicorn sends startup/shutdown
    events and no handler is registered.  This callable completes the
    handshake cleanly without doing anything else — the Redis channel layer
    connects lazily on first use, so no explicit startup action is needed.
    """
    while True:
        event = await receive()
        if event['type'] == 'lifespan.startup':
            await send({'type': 'lifespan.startup.complete'})
        elif event['type'] == 'lifespan.shutdown':
            await send({'type': 'lifespan.shutdown.complete'})
            return

application = ProtocolTypeRouter({
    'http':      django_asgi_app,
    'websocket': URLRouter(all_websocket_urlpatterns),
    # Lifespan handler — required when uvicorn runs with --lifespan on.
    # Channels 4's ProtocolTypeRouter raises ValueError without this when
    # uvicorn sends the startup/shutdown events.
    # We use a minimal async callable that just completes the handshake.
    'lifespan':  _lifespan_handler,
})
