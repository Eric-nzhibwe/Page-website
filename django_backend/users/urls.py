"""
User URLs for ARTX Platform
"""
from django.urls import path
from . import views

urlpatterns = [
    # Authentication
    path('register/', views.UserRegistrationView.as_view(), name='user-register'),
    path('login/', views.login_view, name='user-login'),
    path('logout/', views.logout_view, name='user-logout'),
    path('verify-otp/', views.verify_otp_view, name='verify-otp'),
    path('resend-otp/', views.resend_otp_view, name='resend-otp'),

    # Profile
    path('profile/', views.UserProfileView.as_view(), name='user-profile'),
    path('stats/', views.user_stats_view, name='user-stats'),
    path('activities/', views.UserActivitiesView.as_view(), name='user-activities'),
    path('discover/', views.discover_users_view, name='discover-users'),
    path('search/', views.search_users_view, name='search-users'),

    # Submissions
    path('submit/', views.SubmitAnswerView.as_view(), name='submit-answer'),

    # Leaderboard
    path('leaderboard/', views.LeaderboardView.as_view(), name='leaderboard'),

    # Social connections
    path('social/connect/', views.add_social_connection_view, name='add-social-connection'),
    path('social/disconnect/<str:platform>/', views.remove_social_connection_view, name='remove-social-connection'),

    # Settings
    path('change-password/', views.change_password_view, name='change-password'),
    path('avatar/', views.upload_avatar_view, name='upload-avatar'),
    path('logout-all/', views.logout_all_devices_view, name='logout-all'),
    path('sessions/', views.active_sessions_view, name='active-sessions'),
    path('preferences/', views.update_preferences_view, name='update-preferences'),
    path('deactivate/', views.deactivate_account_view, name='deactivate-account'),
    path('delete-account/', views.delete_account_view, name='delete-account'),
    path('spend-prestige/', views.spend_prestige_view, name='spend-prestige'),
]