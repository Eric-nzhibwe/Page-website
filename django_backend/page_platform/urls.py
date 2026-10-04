"""
URL configuration for PAGE Platform
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import RedirectView
from django.http import JsonResponse


def health(request):
    return JsonResponse({'status': 'ok'})


def media_fallback(request, path):
    """
    Catch-all for /media/ requests when files are missing from Render's
    ephemeral disk. Returns a redirect to a default avatar instead of 404.
    Once Cloudinary is configured, Django never hits this handler because
    Cloudinary URLs are absolute (https://res.cloudinary.com/...) and don't
    go through Django at all.
    """
    from django.http import HttpResponsePermanentRedirect
    # Redirect to a generic avatar icon served from static files
    return HttpResponsePermanentRedirect('/static/frontend/images/Page.jpeg')


def ws_status(request):
    """
    Tell the frontend whether WebSockets (Redis) are available.
    The frontend probes this before opening any WS connection so it can
    fall back to polling gracefully instead of spamming failed WS attempts.
    """
    from django.conf import settings as _s
    redis_url   = getattr(_s, 'REDIS_URL', '').strip()
    ws_enabled  = bool(redis_url) and any(
        redis_url.startswith(s) for s in ('redis://', 'rediss://', 'unix://')
    )
    return JsonResponse({
        'websockets_enabled': ws_enabled,
        'channel_layer':      'redis' if ws_enabled else 'memory',
        'polling_interval':   0 if ws_enabled else 15,   # seconds
    })


urlpatterns = [
    path('admin/', admin.site.urls),

    # Health check — used by UptimeRobot / Render health checks
    path('health/', health),

    # WebSocket / Redis availability probe — called by frontend before opening WS
    path('api/ws-status/', ws_status),

    # Redirect root → frontend index (WhiteNoise serves static/frontend/)
    path('', RedirectView.as_view(url='/static/frontend/index.html', permanent=False)),

    # API routes
    path('api/users/',         include('users.urls')),
    path('api/auth/',          include('users.urls')),   # alias used by frontend auth.js
    path('api/challenges/',    include('challenges.urls')),
    path('api/tournaments/',   include('tournaments.urls')),
    path('api/alliances/',     include('alliances.urls')),
    path('api/payments/',      include('payments.urls')),
    path('api/messenger/',     include('messenger.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/social/',        include('social.urls')),
    path('api/chatbot/',       include('chatbot.urls')),

    # Fallback for missing /media/ files (Render ephemeral disk — files lost on restart)
    # Remove this once Cloudinary is configured (new uploads go directly to Cloudinary CDN)
    path('media/<path:path>', media_fallback),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
