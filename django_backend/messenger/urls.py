from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ConversationViewSet, available_users_view, unread_count_view

router = DefaultRouter()
router.register(r'conversations', ConversationViewSet, basename='conversation')

urlpatterns = [
    path('', include(router.urls)),
    path('available-users/', available_users_view, name='available-users'),
    path('unread-count/', unread_count_view, name='unread-count'),
]
