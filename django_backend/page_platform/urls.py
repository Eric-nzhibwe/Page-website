"""
URL configuration for PAGE Platform
"""
import mimetypes
from pathlib import Path

from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.http import FileResponse, Http404, HttpResponsePermanentRedirect, JsonResponse
from django.urls import include, path, re_path
from django.views.generic import RedirectView


def health(request):
    return JsonResponse({"status": "ok"})


def media_fallback(request, path):
    """
    Catch-all for /media/ requests when files are missing from Render's
    ephemeral disk. Returns a redirect to a default avatar instead of 404.
    Once Cloudinary is configured, Django never hits this handler because
    Cloudinary URLs are absolute (https://res.cloudinary.com/...) and don't
    go through Django at all.
    """
    return HttpResponsePermanentRedirect("/static/frontend/images/Page.jpeg")


def serve_frontend_file(request, subpath=""):
    """
    Serve any frontend file (HTML, JS, CSS, images, favicon) from the
    staticfiles/frontend directory, mapping the short public path directly.

    Examples:
      /index.html           -> staticfiles/frontend/index.html
      /favicon.ico          -> staticfiles/frontend/favicon.ico
      /pages/auth.html      -> staticfiles/frontend/pages/auth.html
      /scripts/app.js       -> staticfiles/frontend/scripts/app.js
      /styles/styles.css    -> staticfiles/frontend/styles/styles.css
      /images/logo.png      -> staticfiles/frontend/images/logo.png
    """
    roots = []
    if settings.STATIC_ROOT:
        roots.append(Path(settings.STATIC_ROOT) / "frontend")
    if settings.STATICFILES_DIRS:
        roots.append(Path(settings.STATICFILES_DIRS[0]) / "frontend")

    for root in roots:
        candidate = root / subpath
        if candidate.exists() and candidate.is_file():
            content_type, _ = mimetypes.guess_type(str(candidate))
            return FileResponse(
                open(candidate, "rb"),
                content_type=content_type or "application/octet-stream",
            )

    raise Http404(f"Frontend file not found: {subpath}")


def ws_status(request):
    """
    Tell the frontend whether WebSockets (Redis) are available.
    Returns both 'ws_supported' (read by websocket-client.js and realtime-updates.js)
    and 'websockets_enabled' for backward compat.
    """
    redis_url = getattr(settings, "REDIS_URL", "").strip()
    ws_enabled = bool(redis_url) and any(
        redis_url.startswith(s) for s in ("redis://", "rediss://", "unix://")
    )
    return JsonResponse({
        "ws_supported": ws_enabled,           # ← read by websocket-client.js + realtime-updates.js
        "websockets_enabled": ws_enabled,     # ← kept for any other consumers
        "channel_layer": "redis" if ws_enabled else "memory",
        "polling_interval": 0 if ws_enabled else 15,
    })


urlpatterns = [
    path("admin/", admin.site.urls),

    # Health check
    path("health/", health),

    # WebSocket / Redis availability probe
    path("api/ws-status/", ws_status),

    # Root → index
    path("", RedirectView.as_view(url="/static/frontend/index.html", permanent=False)),

    # Top-level files: /index.html, /favicon.ico, /googleXXX.html, etc.
    re_path(r"^(?P<subpath>[^/]+\.[a-zA-Z0-9]+)$", serve_frontend_file),

    # Sub-directory frontend assets: /pages/*, /scripts/*, /styles/*, /images/*
    re_path(r"^(?P<subpath>(?:pages|scripts|styles|images)/.+)$", serve_frontend_file),

    # API routes
    path("api/users/",         include("users.urls")),
    path("api/auth/",          include("users.urls")),
    path("api/challenges/",    include("challenges.urls")),
    path("api/tournaments/",   include("tournaments.urls")),
    path("api/alliances/",     include("alliances.urls")),
    path("api/payments/",      include("payments.urls")),
    path("api/messenger/",     include("messenger.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/social/",        include("social.urls")),
    path("api/chatbot/",       include("chatbot.urls")),

    # Fallback for missing /media/ files (Render ephemeral disk)
    path("media/<path:path>", media_fallback),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
