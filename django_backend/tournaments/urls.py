"""
Tournament URLs for ARTX Platform
"""
from django.urls import path
from . import views

app_name = 'tournaments'

urlpatterns = [
    # Tournament list and details
    path('', views.tournament_list, name='tournament_list'),
    path('<int:tournament_id>/', views.tournament_detail, name='tournament_detail'),
    
    # Tournament participation
    path('<int:tournament_id>/join/', views.join_tournament, name='join_tournament'),
]