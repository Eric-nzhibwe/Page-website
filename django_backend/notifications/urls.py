"""
Notifications URLs for ARTX Platform
"""
from django.urls import path
from . import views

urlpatterns = [
    # In-app notifications (used by the bell icon)
    path('',          views.list_notifications,      name='list_notifications'),
    path('read/',     views.mark_notifications_read,  name='mark_read'),

    # Email notifications
    path('send-email/', views.send_email_notification, name='send_email'),
    path('send-sms/',   views.send_sms_notification,   name='send_sms'),
    path('preferences/', views.notification_preferences, name='notification_preferences'),
    path('history/',     views.notification_history,     name='notification_history'),
    path('tier-upgrade/',  views.tier_upgrade_notification,  name='tier_upgrade_notification'),
    path('alliance-join/', views.alliance_join_notification, name='alliance_join_notification'),
]