"""
User admin — ARTX Platform
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (
    User, UserActivity, UserSubmission,
    LoginHistory, EmailVerificationToken, PasswordResetToken,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = [
        'username', 'email', 'display_name', 'prestige_points',
        'level', 'access_tier', 'is_verified', 'email_verified',
        'failed_login_attempts', 'created_at',
    ]
    list_filter  = ['access_tier', 'power_rank', 'is_verified', 'email_verified', 'created_at']
    search_fields = ['username', 'email', 'display_name']
    ordering     = ['-prestige_points']

    fieldsets = BaseUserAdmin.fieldsets + (
        ('ARTX Profile', {
            'fields': ('display_name', 'bio', 'profile_image'),
        }),
        ('Gaming Stats', {
            'fields': ('prestige_points', 'level', 'power_rank', 'access_tier', 'current_streak'),
        }),
        ('Submissions', {
            'fields': ('total_submissions', 'successful_submissions', 'tournament_wins'),
        }),
        ('Financial', {
            'fields': ('total_earnings',),
        }),
        ('Verification', {
            'fields': (
                'is_verified', 'email_verified', 'email_verified_at',
                'verification_level', 'social_connections',
            ),
        }),
        ('Security', {
            'fields': (
                'failed_login_attempts', 'locked_until',
                'password_changed_at', 'last_login_ip',
            ),
        }),
    )
    readonly_fields = [
        'created_at', 'last_login_date', 'email_verified_at',
        'password_changed_at', 'last_login_ip',
    ]
    actions = ['unlock_accounts', 'force_email_verification']

    def get_queryset(self, request):
        return super().get_queryset(request).select_related()

    def unlock_accounts(self, request, queryset):
        queryset.update(failed_login_attempts=0, locked_until=None)
        self.message_user(request, f'Unlocked {queryset.count()} account(s).')
    unlock_accounts.short_description = 'Unlock selected accounts'

    def force_email_verification(self, request, queryset):
        from django.utils import timezone
        queryset.update(
            email_verified=True,
            email_verified_at=timezone.now(),
            is_verified=True,
        )
        self.message_user(request, f'Verified {queryset.count()} account(s).')
    force_email_verification.short_description = 'Mark email as verified'


@admin.register(UserActivity)
class UserActivityAdmin(admin.ModelAdmin):
    list_display  = ['user', 'activity_type', 'description', 'points_change', 'created_at']
    list_filter   = ['activity_type', 'created_at']
    search_fields = ['user__username', 'user__email', 'description']
    ordering      = ['-created_at']
    readonly_fields = ['created_at']

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')


@admin.register(UserSubmission)
class UserSubmissionAdmin(admin.ModelAdmin):
    list_display  = ['user', 'challenge_id', 'is_correct', 'points_earned', 'difficulty', 'submitted_at']
    list_filter   = ['is_correct', 'difficulty', 'submitted_at']
    search_fields = ['user__username', 'user__email', 'challenge_id']
    ordering      = ['-submitted_at']
    readonly_fields = ['submitted_at']

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')


@admin.register(LoginHistory)
class LoginHistoryAdmin(admin.ModelAdmin):
    list_display  = ['identifier', 'user', 'status', 'ip_address', 'created_at']
    list_filter   = ['status', 'created_at']
    search_fields = ['identifier', 'user__username', 'ip_address']
    ordering      = ['-created_at']
    readonly_fields = ['identifier', 'user', 'status', 'ip_address', 'user_agent', 'created_at']

    def has_add_permission(self, request):
        return False  # Immutable audit log

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display  = ['user', 'used', 'created_at', 'expires_at']
    list_filter   = ['used']
    search_fields = ['user__email', 'user__username']
    readonly_fields = ['token', 'created_at']


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display  = ['user', 'used', 'created_at', 'expires_at']
    list_filter   = ['used']
    search_fields = ['user__email', 'user__username']
    readonly_fields = ['token', 'created_at']
