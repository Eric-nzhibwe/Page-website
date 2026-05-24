"""
ARTX Platform URL Configuration
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from .frontend_views import serve_frontend_file, serve_favicon

urlpatterns = [
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