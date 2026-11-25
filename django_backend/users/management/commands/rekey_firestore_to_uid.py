"""
Management command: rekey_firestore_to_uid
==========================================
One-time migration: moves user_profiles Firestore documents from their
old SQL-integer-id keys to Firebase-uid keys.

After this, every document is keyed by the user's stable Firebase UID,
so the profiles survive Render Postgres expiry and DB rebuilds without
accumulating orphaned duplicates.

What it does:
  1. Streams all user_profiles docs.
  2. For each doc that is NOT already keyed by a firebase_uid (i.e. its id
     looks like a numeric SQL pk), looks up the matching uid from Postgres
     (via UserFirebaseProfile) or from the doc's own firebase_uid field.
  3. Copies the doc to users_profiles/{firebase_uid} (preserves all fields).
  4. Deletes the old numeric-keyed doc.

Safe to run multiple times — already-keyed docs are skipped.

Usage:
    python manage.py rekey_firestore_to_uid
    python manage.py rekey_firestore_to_uid --dry-run
"""

import logging
from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


def _looks_like_sql_id(doc_id: str) -> bool:
    """True if the doc id is an integer (old SQL pk keying)."""
    return doc_id.isdigit()


class Command(BaseCommand):
    help = 'Rekey Firestore user_profiles documents from SQL ids to Firebase uids.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            default=False,
            help='Preview changes without writing to Firestore.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be written.'))

        # ── Check Firebase ────────────────────────────────────────────────────
        try:
            from page_platform.firebase_client import firebase_enabled, get_firestore
            if not firebase_enabled():
                self.stdout.write(self.style.ERROR(
                    'Firebase not configured — cannot rekey documents.'
                ))
                return
            db = get_firestore()
            if db is None:
                self.stdout.write(self.style.ERROR('Firestore client unavailable.'))
                return
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'Firebase init error: {exc}'))
            return

        COLLECTION = 'user_profiles'
        self.stdout.write('Streaming user_profiles docs…')

        docs = list(db.collection(COLLECTION).stream())
        self.stdout.write(f'  Found {len(docs)} documents.')

        rekeyed = skipped = errors = 0

        for doc in docs:
            doc_id = doc.id

            # Already keyed by a uid — skip
            if not _looks_like_sql_id(doc_id):
                skipped += 1
                continue

            data = doc.to_dict()

            # Resolve uid: prefer the stored firebase_uid field, then DB lookup
            uid = data.get('firebase_uid', '').strip()

            if not uid:
                try:
                    from users.models import UserFirebaseProfile
                    fp = UserFirebaseProfile.objects.select_related('user').get(
                        user_id=doc_id
                    )
                    uid = fp.firebase_uid
                except Exception:
                    pass

            if not uid:
                self.stdout.write(self.style.WARNING(
                    f'  SKIP doc={doc_id} — could not resolve firebase_uid'
                ))
                skipped += 1
                continue

            # Already has a uid-keyed doc — just delete the stale numeric one
            new_ref = db.collection(COLLECTION).document(uid)
            old_ref = db.collection(COLLECTION).document(doc_id)

            if dry_run:
                new_snap = new_ref.get()
                action = 'merge-rekey' if new_snap.exists else 'rekey'
                self.stdout.write(
                    f'  [DRY RUN] {action}: {doc_id} → {uid}'
                )
                rekeyed += 1
                continue

            try:
                # Write to new key (merge so we don't wipe partial updates)
                new_ref.set(data, merge=True)
                # Remove old numeric-keyed doc
                old_ref.delete()
                self.stdout.write(f'  Rekeyed: {doc_id} → {uid}')
                rekeyed += 1
            except Exception as exc:
                errors += 1
                logger.error(f'rekey_firestore_to_uid: error on doc={doc_id}: {exc}')
                self.stdout.write(self.style.ERROR(
                    f'  ERROR doc={doc_id}: {exc}'
                ))

        prefix = '[DRY RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}Done — rekeyed={rekeyed}, skipped(already uid-keyed)={skipped}, errors={errors}'
        ))
