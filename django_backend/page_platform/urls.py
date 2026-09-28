"""
URL configuration for PAGE Platform
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),

    # API routes
    path('api/users/',         include('users.urls')),
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
