"""
User admin for ARTX Platform
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, UserActivity, UserSubmission


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Enhanced User admin"""
    
    list_display = ['username', 'email', 'display_name', 'prestige_points', 'level', 'access_tier', 'is_verified', 'created_at']
    list_filter = ['access_tier', 'power_rank', 'is_verified', 'verification_level', 'created_at']
    search_fields = ['username', 'email', 'display_name']
    ordering = ['-prestige_points']
    
    fieldsets = BaseUserAdmin.fieldsets + (
        ('ARTX Profile', {
            'fields': ('display_name', 'bio', 'profile_image')
        }),
        ('Gaming Stats', {
            'fields': ('prestige_points', 'level', 'power_rank', 'access_tier', 'current_streak')
        }),
        ('Submissions', {
            'fields': ('total_submissions', 'successful_submissions', 'tournament_wins')
        }),
        ('Financial', {
            'fields': ('total_earnings',)
        }),
        ('Verification', {
            'fields': ('is_verified', 'verification_level', 'social_connections')
        }),
    )
    
    readonly_fields = ['created_at', 'last_login_date']
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related()


@admin.register(UserActivity)
class UserActivityAdmin(admin.ModelAdmin):
    """User Activity admin"""
    
    list_display = ['user', 'activity_type', 'description', 'points_change', 'created_at']
    list_filter = ['activity_type', 'created_at']
    search_fields = ['user__username', 'user__email', 'description']
    ordering = ['-created_at']
    readonly_fields = ['created_at']
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')


@admin.register(UserSubmission)
class UserSubmissionAdmin(admin.ModelAdmin):
    """User Submission admin"""
    
    list_display = ['user', 'challenge_id', 'is_correct', 'points_earned', 'difficulty', 'submitted_at']
    list_filter = ['is_correct', 'difficulty', 'submitted_at']
    search_fields = ['user__username', 'user__email', 'challenge_id']
    ordering = ['-submitted_at']
    readonly_fields = ['submitted_at']
    
    def get_queryset(self, request):
        return super().get_queryset(request).select_related('user')