"""
Signals for challenge app — update leaderboard, log activity, and
broadcast real-time events to connected WebSocket clients.
"""
import logging
from django.db.models.signals import post_save
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import ChallengeSubmission, ChallengeLeaderboard, ChallengeActivity, ImageInterpretationSubmission

logger = logging.getLogger(__name__)


def _broadcast(challenge_id, msg_type, payload):
    """
    Push a message to every WebSocket client subscribed to
    the challenge group.  Silently swallows errors so a missing
    channel layer never breaks the save() call chain.
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        group_name = f"challenge_{challenge_id}"
        async_to_sync(channel_layer.group_send)(
            group_name,
            {"type": msg_type, "payload": payload},
        )
    except Exception as exc:
        logger.warning("WebSocket broadcast failed for challenge %s: %s", challenge_id, exc)


# ── Text Interpretation ───────────────────────────────────────────────────────

@receiver(post_save, sender=ChallengeSubmission)
def update_leaderboard_on_submission(sender, instance, created, **kwargs):
    """Rebuild the leaderboard cache whenever a submission is scored."""
    if instance.status == 'scored':
        leaderboard, _ = ChallengeLeaderboard.objects.get_or_create(
            challenge=instance.challenge
        )
        leaderboard.update_leaderboard()

        # Broadcast updated leaderboard to all open challenge tabs
        _broadcast(
            instance.challenge_id,
            "leaderboard_update",
            {
                "challenge_id":      str(instance.challenge_id),
                "top_submissions":   leaderboard.top_submissions,
                "total_participants": leaderboard.total_participants,
                "average_score":     leaderboard.average_score,
                "highest_score":     leaderboard.highest_score,
            },
        )


@receiver(post_save, sender=ChallengeSubmission)
def create_activity_on_submission(sender, instance, created, **kwargs):
    """Log activity and push live feed item when a submission is created or scored."""
    challenge_id = instance.challenge_id

    if created:
        # New submission entered — tell the room someone joined
        _broadcast(
            challenge_id,
            "new_submission",
            {
                "challenge_id": str(challenge_id),
                "username":     instance.user.username,
                "submitted_at": instance.submitted_at.isoformat(),
            },
        )

    if instance.status == 'scored' and instance.scored_at:
        activity, activity_created = ChallengeActivity.objects.get_or_create(
            challenge=instance.challenge,
            user=instance.user,
            activity_type='score_update',
            defaults={
                'description': f"{instance.user.username} scored {instance.final_score} points",
                'metadata': {
                    'submission_id': str(instance.id),
                    'score':         instance.final_score,
                    'word_count':    instance.word_count,
                },
            },
        )

        # Broadcast activity item
        _broadcast(
            challenge_id,
            "activity",
            {
                "challenge_id": str(challenge_id),
                "username":     instance.user.username,
                "description":  activity.description,
                "score":        instance.final_score,
                "created_at":   activity.created_at.isoformat(),
            },
        )


# ── Image Interpretation ─────────────────────────────────────────────────────

@receiver(post_save, sender=ImageInterpretationSubmission)
def broadcast_image_submission(sender, instance, created, **kwargs):
    """Broadcast image interpretation events to the challenge group."""
    challenge_id = instance.challenge_id

    if created:
        _broadcast(
            challenge_id,
            "new_submission",
            {
                "challenge_id": str(challenge_id),
                "username":     instance.user.username,
                "submitted_at": instance.submitted_at.isoformat(),
                "type":         "image_interpretation",
            },
        )

    if instance.status == 'scored' and instance.scored_at:
        _broadcast(
            challenge_id,
            "activity",
            {
                "challenge_id": str(challenge_id),
                "username":     instance.user.username,
                "description":  (
                    f"{instance.user.username} scored {instance.final_score} pts "
                    f"(obs: {instance.observation_score}, interp: {instance.interpretation_score})"
                ),
                "score":        instance.final_score,
                "created_at":   instance.scored_at.isoformat(),
                "type":         "image_interpretation",
            },
        )
