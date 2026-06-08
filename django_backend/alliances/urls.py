"""
Alliance URLs for ARTX Platform
"""
from django.urls import path
from . import views

app_name = 'alliances'

urlpatterns = [
    # Alliance list and details
    path('', views.AllianceListView.as_view(), name='alliance_list'),
    path('<int:pk>/', views.AllianceDetailView.as_view(), name='alliance_detail'),
    path('create/', views.create_alliance_view, name='create_alliance'),
    
    # Alliance membership
    path('<int:alliance_id>/join/', views.join_alliance_view, name='join_alliance'),
    path('<int:alliance_id>/leave/', views.leave_alliance_view, name='leave_alliance'),
    path('<int:alliance_id>/invite/', views.invite_to_alliance_view, name='invite_alliance'),
    
    # Alliance management
    path('<int:alliance_id>/members/', views.AllianceMembersView.as_view(), name='alliance_members'),
    path('<int:alliance_id>/events/', views.AllianceEventsView.as_view(), name='alliance_events'),
    
    # User alliance data
    path('my-alliance/', views.user_alliance_view, name='user_alliance'),
    path('invitations/', views.user_invitations_view, name='user_invitations'),
    path('invitations/<int:invitation_id>/accept/', views.accept_invitation_view, name='accept_invitation'),
    path('invitations/<int:invitation_id>/decline/', views.decline_invitation_view, name='decline_invitation'),
]