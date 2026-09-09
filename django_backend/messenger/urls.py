from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ConversationViewSet, available_users_view,
    unread_count_view, firebase_config_view, mark_read_view,
)

router = DefaultRouter()
router.register(r'conversations', ConversationViewSet, basename='conversation')

urlpatterns = [
    path('', include(router.urls)),
    path('available-users/', available_users_view, name='available-users'),
    path('unread-count/',    unread_count_view,    name='unread-count'),
    path('firebase-config/', firebase_config_view, name='messenger-firebase-config'),
    path('conversations/<int:conversation_id>/mark-read/',
         mark_read_view, name='mark-read'),
]
