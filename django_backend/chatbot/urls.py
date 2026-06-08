"""
Chatbot URLs
"""
from django.urls import path
from . import views

app_name = 'chatbot'

urlpatterns = [
    # Chat endpoint
    path('chat/', views.chat_view, name='chat'),
    
    # Conversation management
    path('conversations/', views.conversation_list_view, name='conversation_list'),
    path('history/', views.conversation_list_view, name='history'),  # Alias for history
    path('conversations/new/', views.conversation_new_view, name='conversation_new'),
    path('conversations/<int:conversation_id>/', views.conversation_detail_view, name='conversation_detail'),
    path('conversations/<int:conversation_id>/delete/', views.conversation_delete_view, name='conversation_delete'),
]

