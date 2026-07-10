"""
Admin configuration for challenges
"""
from django.contrib import admin
from django.utils.html import format_html
from .models import Challenge, ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity, ImageInterpretationSubmission


@admin.register(Challenge)
class ChallengeAdmin(admin.ModelAdmin):
    list_display = ['title', 'challenge_type', 'difficulty', 'status', 'submission_count', 'prize_amount', 'entry_fee', 'ends_at', 'is_featured']
    list_filter = ['challenge_type', 'difficulty', 'status', 'is_featured', 'created_at']
    search_fields = ['title', 'description']
    readonly_fields = ['id', 'created_at', 'updated_at', 'view_count', 'submission_count']
    
    fieldsets = (
        ('Basic Information', {
            'fields': ('id', 'title', 'description', 'image_url', 'created_by')
        }),
        ('Challenge Type', {
            'fields': ('challenge_type', 'hidden_points', 'prize_amount', 'entry_fee'),
            'description': (
                'For image_interpretation challenges, set hidden_points as JSON: '
                '[{"label": "Broken clock", "accepted_meanings": ["lost time", "urgency"]}]'
            ),
        }),
        ('Challenge Settings', {
            'fields': ('difficulty', 'time_limit', 'min_word_count', 'max_word_count', 'submission_rules')
        }),
        ('Scoring', {
            'fields': ('creativity_weight', 'relevance_weight', 'detail_weight', 'min_points', 'max_points')
        }),
        ('Status & Timing', {
            'fields': ('status', 'starts_at', 'ends_at')
        }),
        ('Metadata', {
            'fields': ('is_featured', 'view_count', 'submission_count', 'created_at', 'updated_at')
        }),
    )


@admin.register(ChallengeSubmission)
class ChallengeSubmissionAdmin(admin.ModelAdmin):
    list_display = ['user', 'challenge', 'status', 'final_score', 'submitted_at']
    list_filter = ['status', 'challenge', 'submitted_at']
    search_fields = ['user__username', 'challenge__title']
    readonly_fields = ['id', 'submitted_at', 'scored_at', 'word_count']
    
    fieldsets = (
        ('Submission Info', {
            'fields': ('id', 'challenge', 'user', 'submitted_at', 'scored_at')
        }),
        ('Content', {
            'fields': ('interpretation', 'word_count', 'submission_time_seconds')
        }),
        ('Scoring', {
            'fields': ('status', 'creativity_score', 'relevance_score', 'detail_score', 'final_score')
        }),
    )


@admin.register(ImageInterpretationSubmission)
class ImageInterpretationSubmissionAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'challenge', 'status', 'final_score',
        'observation_score', 'interpretation_score',
        'points_earned', 'prize_awarded', 'submitted_at',
    ]
    list_filter  = ['status', 'challenge', 'submitted_at']
    search_fields = ['user__username', 'challenge__title']
    readonly_fields = [
        'id', 'submitted_at', 'scored_at',
        'observation_score', 'interpretation_score', 'final_score',
        'points_earned', 'prize_awarded', 'ai_feedback',
    ]

    fieldsets = (
        ('Submission', {
            'fields': ('id', 'challenge', 'user', 'submitted_at', 'scored_at', 'status'),
        }),
        ('Content', {
            'fields': ('discovered_points', 'overall_message', 'submission_time_seconds'),
        }),
        ('Scores', {
            'fields': (
                'observation_score', 'interpretation_score',
                'final_score', 'points_earned', 'prize_awarded',
            ),
        }),
        ('AI Feedback', {
            'fields': ('ai_feedback',),
            'classes': ('collapse',),
        }),
    )


@admin.register(ChallengeLeaderboard)
class ChallengeLeaderboardAdmin(admin.ModelAdmin):
    list_display = ['challenge', 'total_participants', 'average_score', 'highest_score', 'updated_at']
    list_filter = ['created_at', 'updated_at']
    search_fields = ['challenge__title']
    readonly_fields = ['id', 'created_at', 'updated_at']


@admin.register(ChallengeActivity)
class ChallengeActivityAdmin(admin.ModelAdmin):
    list_display = ['user', 'challenge', 'activity_type', 'created_at']
    list_filter = ['activity_type', 'created_at', 'challenge']
    search_fields = ['user__username', 'challenge__title', 'description']
    readonly_fields = ['id', 'created_at']
