"""
ASGI config for ARTX Platform project.
"""
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
import social.routing
import notifications.routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(
            social.routing.websocket_urlpatterns +
            notifications.routing.websocket_urlpatterns
        )
    ),
})