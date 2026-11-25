from django.urls import path
from . import views

app_name = 'chatbot'

urlpatterns = [
    path('chat/',                   views.chat,           name='chat'),
    path('media/',                  views.media_chat,     name='media_chat'),
    path('transcribe/',             views.transcribe,     name='transcribe'),
    path('sessions/',               views.session_list,   name='session_list'),
    path('sessions/<int:session_id>/', views.session_detail, name='session_detail'),
    path('status/',                 views.status,         name='status'),
]
