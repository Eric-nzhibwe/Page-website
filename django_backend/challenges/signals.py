"""
Signals for challenge app
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from .models import ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity


@receiver(post_save, sender=ChallengeSubmission)
def update_leaderboard_on_submission(sender, instance, created, **kwargs):
    """Update leaderboard when a submission is scored"""
    if instance.status == 'scored':
        leaderboard, _ = ChallengeLeaderboard.objects.get_or_create(challenge=instance.challenge)
        leaderboard.update_leaderboard()


@receiver(post_save, sender=ChallengeSubmission)
def create_activity_on_score(sender, instance, created, **kwargs):
    """Create activity when submission is scored"""
    if instance.status == 'scored' and instance.scored_at:
        ChallengeActivity.objects.get_or_create(
            challenge=instance.challenge,
            user=instance.user,
            activity_type='score_update',
            defaults={
                'description': f"{instance.user.username} scored {instance.final_score} points",
                'metadata': {
                    'submission_id': str(instance.id),
                    'score': instance.final_score,
                    'word_count': instance.word_count
                }
            }
        )
