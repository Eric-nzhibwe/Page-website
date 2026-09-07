"""
Firestore Notifications Service
=================================
Drop-in replacement for the PostgreSQL-backed InAppNotification queries.
Called by notifications/views.py and notifications/views.py helpers when
settings.FIRESTORE_COLLECTIONS['notifications'] is True.

Firestore collection layout
---------------------------
  notifications/
    {doc_id}/
      recipient_id   : str   — UUID of the user who receives this
      actor_id       : str   — UUID of the actor (may be null)
      actor_username : str
      actor_display  : str
      actor_avatar   : str | null
      notif_type     : str   — follow | comment | reaction | share | mention | system
      title          : str
      message        : str
      link           : str
      is_read        : bool
      created_at     : Timestamp

Indexes (create in Firebase Console → Firestore → Indexes):
  Collection: notifications
  Fields: recipient_id ASC, created_at DESC        (composite)
  Fields: recipient_id ASC, is_read ASC, created_at DESC  (composite)
"""

import logging
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger = logging.getLogger(__name__)

COLLECTION = 'notifications'


# ─────────────────────────────────────────────────────────────────────────────
#  Write
# ─────────────────────────────────────────────────────────────────────────────

def create_notification(recipient, notif_type, title, message, actor=None, link=''):
    """
    Write a new notification document to Firestore.
    Returns the Firestore document reference, or None on failure.
    """
    db = get_firestore()
    if db is None:
        logger.warning('create_notification called but Firestore is not available.')
        return None

    if actor and str(actor.id) == str(recipient.id):
        return None  # never notify yourself

    doc = {
        'recipient_id':    str(recipient.id),
        'actor_id':        str(actor.id)  if actor else None,
        'actor_username':  actor.username if actor else None,
        'actor_display':   (actor.display_name or actor.username) if actor else None,
        'actor_avatar':    (actor.profile_image.url if actor.profile_image else None) if actor else None,
        'notif_type':      notif_type,
        'title':           title,
        'message':         message,
        'link':            link or '',
        'is_read':         False,
        'created_at':      datetime.now(tz=timezone.utc),
    }

    try:
        ref = db.collection(COLLECTION).add(doc)
        # ref is a tuple (update_time, DocumentReference) in firebase-admin
        doc_ref = ref[1] if isinstance(ref, tuple) else ref
        doc['id'] = doc_ref.id
        return doc
    except Exception as exc:
        logger.error(f'Firestore create_notification error: {exc}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────

def list_notifications(user, limit=50):
    """
    Fetch the most recent `limit` notifications for `user`.
    Returns a list of plain dicts (same shape as the REST serialiser output).
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        query = (
            db.collection(COLLECTION)
            .where('recipient_id', '==', str(user.id))
            .order_by('created_at', direction='DESCENDING')
            .limit(limit)
        )
        docs = query.stream()
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            results.append(_format(d))
        return results
    except Exception as exc:
        logger.error(f'Firestore list_notifications error: {exc}')
        return []


def unread_count(user):
    """Return the number of unread notifications for `user`."""
    db = get_firestore()
    if db is None:
        return 0

    try:
        query = (
            db.collection(COLLECTION)
            .where('recipient_id', '==', str(user.id))
            .where('is_read', '==', False)
        )
        # count() is available in firebase-admin >= 6.2 with Firestore
        # Fall back to len(list(...)) for older SDK versions.
        try:
            return query.count().get()[0][0].value
        except Exception:
            return sum(1 for _ in query.stream())
    except Exception as exc:
        logger.error(f'Firestore unread_count error: {exc}')
        return 0


# ─────────────────────────────────────────────────────────────────────────────
#  Update
# ─────────────────────────────────────────────────────────────────────────────

def mark_read(user, ids=None):
    """
    Mark notifications as read.
    `ids` — list of Firestore document IDs to mark; omit to mark all unread.
    Returns the number of documents updated.
    """
    db = get_firestore()
    if db is None:
        return 0

    try:
        if ids:
            # Mark specific documents
            updated = 0
            for doc_id in ids:
                ref = db.collection(COLLECTION).document(doc_id)
                snap = ref.get()
                if snap.exists and snap.to_dict().get('recipient_id') == str(user.id):
                    ref.update({'is_read': True})
                    updated += 1
            return updated
        else:
            # Mark all unread for this user using a batched write
            query = (
                db.collection(COLLECTION)
                .where('recipient_id', '==', str(user.id))
                .where('is_read', '==', False)
            )
            docs  = list(query.stream())
            batch = db.batch()
            for doc in docs:
                batch.update(doc.reference, {'is_read': True})
            batch.commit()
            return len(docs)
    except Exception as exc:
        logger.error(f'Firestore mark_read error: {exc}')
        return 0


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(queryset):
    """
    One-time migration: copy existing InAppNotification rows from PostgreSQL
    into Firestore.  Call from a management command, not from a view.

    Usage:
        from notifications.models import InAppNotification
        from notifications.firestore_service import migrate_from_postgres
        migrate_from_postgres(InAppNotification.objects.select_related('actor'))
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate_from_postgres: Firestore not available.')
        return 0

    BATCH_SIZE = 400   # Firestore batch limit is 500
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for n in queryset.iterator():
        actor = n.actor
        doc = {
            'recipient_id':   str(n.recipient_id),
            'actor_id':       str(actor.id)  if actor else None,
            'actor_username': actor.username if actor else None,
            'actor_display':  (actor.display_name or actor.username) if actor else None,
            'actor_avatar':   (actor.profile_image.url if actor.profile_image else None) if actor else None,
            'notif_type':     n.notif_type,
            'title':          n.title,
            'message':        n.message,
            'link':           n.link or '',
            'is_read':        n.is_read,
            'created_at':     n.created_at,
            '_pg_id':         n.id,   # keep original PG id for reference
        }
        ref = db.collection(COLLECTION).document()
        batch.set(ref, doc)
        count += 1
        migrated += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0
            logger.info(f'migrate_from_postgres: {migrated} notifications written…')

    if count > 0:
        batch.commit()

    logger.info(f'migrate_from_postgres: done — {migrated} total notifications migrated.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _format(d: dict) -> dict:
    """Normalise a Firestore document dict to the REST API shape."""
    created = d.get('created_at')
    if hasattr(created, 'isoformat'):
        created = created.isoformat()
    elif hasattr(created, 'strftime'):
        created = created.strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    actor = None
    if d.get('actor_id'):
        actor = {
            'username':      d.get('actor_username', ''),
            'display_name':  d.get('actor_display', ''),
            'profile_image': d.get('actor_avatar'),
        }

    return {
        'id':         d.get('id', ''),
        'type':       d.get('notif_type', 'system'),
        'title':      d.get('title', ''),
        'message':    d.get('message', ''),
        'link':       d.get('link', ''),
        'is_read':    d.get('is_read', False),
        'created_at': created,
        'actor':      actor,
    }
