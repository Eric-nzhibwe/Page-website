"""
ARTX Platform URL Configuration
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.http import JsonResponse, FileResponse, Http404
from django.views.decorators.http import require_GET
import os
from .frontend_views import serve_frontend_file, serve_favicon


def health_check(request):
    """Lightweight health check — no DB query, just confirms the process is alive."""
    return JsonResponse({'status': 'ok'})


@require_GET
def serve_media_file(request, file_path):
    """
    Serve uploaded media files (voice messages, profile images, post media).
    Works in both development and production (Render).
    Render free tier uses an ephemeral filesystem — files persist for the
    lifetime of the deployment but are cleared on restart.
    """
    full_path = os.path.join(settings.MEDIA_ROOT, file_path)
    # Security: prevent path traversal
    full_path = os.path.abspath(full_path)
    media_root = os.path.abspath(str(settings.MEDIA_ROOT))
    if not full_path.startswith(media_root):
        raise Http404('Access denied')
    if not os.path.isfile(full_path):
        raise Http404('Media file not found')
    import mimetypes
    content_type, _ = mimetypes.guess_type(full_path)
    response = FileResponse(
        open(full_path, 'rb'),
        content_type=content_type or 'application/octet-stream',
    )
    # Allow audio to be played cross-origin (needed when frontend is on same domain)
    response['Accept-Ranges'] = 'bytes'
    response['Cache-Control'] = 'private, max-age=86400'
    return response


urlpatterns = [
    # Health check — used by UptimeRobot / self-ping to prevent Render cold starts
    path('health/', health_check, name='health'),

    # Media files — served in both dev and production
    # Must come before the catch-all frontend routes
    path('media/<path:file_path>', serve_media_file, name='serve_media'),

    # Admin
    path('admin/', admin.site.urls),
    
    # API endpoints
    path('api/auth/', include('users.urls')),
    path('api/payments/', include('payments.urls')),
    path('api/tournaments/', include('tournaments.urls')),
    path('api/alliances/', include('alliances.urls')),
    path('api/notifications/', include('notifications.urls')),
    path('api/chatbot/', include('chatbot.urls')),
    path('api/challenges/', include('challenges.urls')),
    path('api/social/', include('social.urls')),  # <-- ADDED THIS
    path('api/messenger/', include('messenger.urls')),
    
    # Webhooks
    path('webhooks/', include('payments.webhook_urls')),
    
    # Frontend static files - specific paths
    path('pages/<path:file_path>', lambda request, file_path: serve_frontend_file(request, f'pages/{file_path}'), name='frontend_pages'),
    path('scripts/<path:file_path>', lambda request, file_path: serve_frontend_file(request, f'scripts/{file_path}'), name='frontend_scripts'),
    path('styles/<path:file_path>', lambda request, file_path: serve_frontend_file(request, f'styles/{file_path}'), name='frontend_styles'),
    path('images/<path:file_path>', lambda request, file_path: serve_frontend_file(request, f'images/{file_path}'), name='frontend_images'),
    
    # Case-insensitive image handling
    path('Images/<path:file_path>', lambda request, file_path: serve_frontend_file(request, f'images/{file_path}'), name='frontend_images_caps'),
    
    # Special files
    path('favicon.ico', serve_favicon, name='favicon'),
    path('reset_frontend.js', lambda request: serve_frontend_file(request, 'reset_frontend.js'), name='reset_frontend'),
    path('reset_storage.html', lambda request: serve_frontend_file(request, 'reset_storage.html'), name='reset_storage'),
    
    # Index.html - both root and direct access
    path('index.html', lambda request: serve_frontend_file(request, 'index.html'), name='index_html'),
    path('', serve_frontend_file, name='home'),
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    
    # Add debug toolbar
    if 'debug_toolbar' in settings.INSTALLED_APPS:
        import debug_toolbar
        urlpatterns = [
            path('__debug__/', include(debug_toolbar.urls)),
        ] + urlpatterns