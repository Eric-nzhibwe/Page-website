"""
URLs for social features
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import PostViewSet, CommentViewSet, FollowViewSet, StoryViewSet

router = DefaultRouter()
router.register(r'posts', PostViewSet, basename='post')
router.register(r'comments', CommentViewSet, basename='comment')
router.register(r'follows', FollowViewSet, basename='follow')
router.register(r'stories', StoryViewSet, basename='story')

urlpatterns = [
    path('', include(router.urls)),
]
