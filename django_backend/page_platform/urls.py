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


urlpatterns = [
    path('admin/', admin.site.urls),

    # Health check — used by UptimeRobot / Render health checks
    path('health/', health),

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
]

# Serve media files in development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
