"""
User signals — auto-sync profile data to Firestore on every save.

Connected in users/apps.py → UserConfig.ready().
Only fires when FS_USERS flag is True AND Firebase is configured.
"""
import logging
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _should_sync():
    """Return True if Firestore user sync is enabled."""
    try:
        from django.conf import settings
        from artx_platform.firebase_client import firebase_enabled
        return (
            settings.FIRESTORE_COLLECTIONS.get('users', False)
            and firebase_enabled()
        )
    except Exception:
        return False


@receiver(post_save, sender='users.User')
def sync_user_profile_to_firestore(sender, instance, created, **kwargs):
    """
    Mirror a User's public profile to Firestore whenever the row is saved.

    Skipped for:
      - raw=True  (bulk inserts / loaddata)
      - FS_USERS flag is False
      - Firebase not configured
    Runs in the foreground on the same thread.  For high-traffic production
    you'd push this to a Celery task, but it's fast enough (< 100 ms) for
    the current scale.
    """
    if kwargs.get('raw', False):
        return  # loaddata / fixtures — skip

    if not _should_sync():
        return

    try:
        from .firestore_user_service import sync_user
        sync_user(instance)
    except Exception as exc:
        # Never let a Firestore failure break a user save
        logger.error(f'sync_user_profile_to_firestore failed for {instance.id}: {exc}')


@receiver(post_save, sender='social.Follow')
def update_follow_counts_on_firestore(sender, instance, created, **kwargs):
    """
    When a Follow is created/updated, bump followers_count on the followed
    user and following_count on the follower in Firestore.
    Only fires when FS_USERS is True.
    """
    if not _should_sync():
        return

    try:
        from .firestore_user_service import update_user_fields
        # Recount from PostgreSQL to stay accurate
        follower  = instance.follower
        following = instance.following
        update_user_fields(str(following.id), {
            'followers_count': following.followers.count(),
        })
        update_user_fields(str(follower.id), {
            'following_count': follower.following.count(),
        })
    except Exception as exc:
        logger.error(f'update_follow_counts_on_firestore failed: {exc}')
