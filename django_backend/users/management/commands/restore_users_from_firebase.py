"""
Management command: restore_users_from_firebase
================================================
Rebuilds the Django User table from Firebase Auth + Firestore.

Run automatically in start.sh on every deploy so a fresh SQLite wipe
(Render ephemeral disk) never results in lost users.

Sources, in priority order:
  1. Firebase Auth  — has every user's email + uid + displayName
  2. Firestore user_profiles — has every user's username, stats, tier, etc.

The command is fully idempotent — safe to run many times.  Existing Django
users are updated (email/display_name kept in sync); new ones are created.
No passwords are stored — authentication always goes through Firebase.

Usage:
    python manage.py restore_users_from_firebase           # sync all
    python manage.py restore_users_from_firebase --dry-run # preview only
    python manage.py restore_users_from_firebase --limit 50
"""

import logging
import re

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()


class Command(BaseCommand):
    help = (
        'Restore/sync Django User rows from Firebase Auth + Firestore. '
        'Safe to run on every startup — creates missing users, updates existing ones.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            default=False,
            help='Preview what would be created/updated without writing anything.',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Only process the first N users (0 = no limit). Useful for testing.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        limit   = options['limit']

        if dry_run:
            self.stdout.write(self.style.WARNING('DRY RUN — no changes will be written.'))

        # ── 1. Check Firebase is configured ───────────────────────────────────
        try:
            from page_platform.firebase_client import firebase_enabled
            if not firebase_enabled():
                self.stdout.write(self.style.WARNING(
                    'Firebase not configured — skipping restore_users_from_firebase. '
                    'Set FIREBASE_SERVICE_ACCOUNT_JSON in your environment.'
                ))
                return
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'Firebase init error: {exc}'))
            return

        # ── 2. List all users from Firebase Auth ──────────────────────────────
        self.stdout.write('Fetching users from Firebase Auth…')
        firebase_users = self._list_firebase_users(limit)
        self.stdout.write(f'  Found {len(firebase_users)} users in Firebase Auth.')

        if not firebase_users:
            self.stdout.write(self.style.WARNING(
                'No users found in Firebase Auth. '
                'Check that your service account has the Firebase Auth admin role.'
            ))
            return

        # ── 3. Fetch all Firestore profiles for enrichment ────────────────────
        self.stdout.write('Fetching Firestore user_profiles…')
        fs_profiles = self._fetch_firestore_profiles()
        self.stdout.write(f'  Found {len(fs_profiles)} Firestore profiles.')

        # ── 4. Upsert Django Users ─────────────────────────────────────────────
        created = updated = skipped = errors = 0

        for fb_user in firebase_users:
            try:
                result = self._upsert_user(fb_user, fs_profiles, dry_run)
                if result == 'created':
                    created += 1
                elif result == 'updated':
                    updated += 1
                else:
                    skipped += 1
            except Exception as exc:
                errors += 1
                self.stdout.write(self.style.ERROR(
                    f'  ERROR processing uid={fb_user.uid}: {exc}'
                ))

        # ── 5. Report ──────────────────────────────────────────────────────────
        prefix = '[DRY RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}Done — created={created}, updated={updated}, '
            f'skipped={skipped}, errors={errors}'
        ))

    # ─────────────────────────────────────────────────────────────────────────
    #  Firebase Auth helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _list_firebase_users(self, limit: int) -> list:
        """Return a list of firebase_admin.auth.UserRecord objects."""
        try:
            import firebase_admin.auth as fb_auth
            records = []
            page = fb_auth.list_users()
            while page:
                records.extend(page.users)
                if limit and len(records) >= limit:
                    records = records[:limit]
                    break
                page = page.get_next_page()
            return records
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'Firebase list_users failed: {exc}'))
            return []

    # ─────────────────────────────────────────────────────────────────────────
    #  Firestore helpers
    # ─────────────────────────────────────────────────────────────────────────

    def _fetch_firestore_profiles(self) -> dict:
        """
        Returns a dict keyed by firebase_uid → profile dict.
        Also indexes by email for fallback lookups.
        """
        try:
            from page_platform.firebase_client import get_firestore
            db = get_firestore()
            if db is None:
                return {}

            profiles = {}
            docs = db.collection('user_profiles').stream()
            for doc in docs:
                d = doc.to_dict()
                d['_doc_id'] = doc.id
                uid = d.get('firebase_uid', '')
                if uid:
                    profiles[uid] = d
                # Also index by doc id in case firebase_uid wasn't stored
                profiles[doc.id] = d
            return profiles
        except Exception as exc:
            self.stdout.write(self.style.WARNING(f'Firestore fetch failed: {exc}'))
            return {}

    # ─────────────────────────────────────────────────────────────────────────
    #  Upsert logic
    # ─────────────────────────────────────────────────────────────────────────

    def _upsert_user(self, fb_user, fs_profiles: dict, dry_run: bool) -> str:
        """
        Create or update a Django User from a Firebase UserRecord.
        Returns 'created', 'updated', or 'skipped'.
        """
        uid   = fb_user.uid
        email = (fb_user.email or '').lower().strip()
        name  = fb_user.display_name or ''

        if not email:
            self.stdout.write(f'  SKIP uid={uid} — no email address in Firebase Auth')
            return 'skipped'

        # Enrich with Firestore profile
        fs = fs_profiles.get(uid) or fs_profiles.get(uid[:28]) or {}

        # Derive username
        username = (
            fs.get('username')
            or self._username_from_email(email)
            or f'user_{uid[:8]}'
        )
        username = self._ensure_unique_username(username, exclude_uid=uid)

        display_name = fs.get('display_name') or name or username

        # ── Find existing Django user ──────────────────────────────────────
        existing_user = None

        # Try by firebase_uid link first (most reliable)
        try:
            from users.models import UserFirebaseProfile
            fp = UserFirebaseProfile.objects.select_related('user').get(firebase_uid=uid)
            existing_user = fp.user
        except Exception:
            pass

        # Fall back to email match
        if existing_user is None:
            try:
                existing_user = User.objects.get(email__iexact=email)
            except User.DoesNotExist:
                pass

        # ── Create new user ────────────────────────────────────────────────
        if existing_user is None:
            if dry_run:
                self.stdout.write(f'  [DRY RUN] Would CREATE: {username} <{email}>')
                return 'created'

            user = User(
                email        = email,
                username     = username,
                display_name = display_name,
            )
            user.set_unusable_password()

            # Restore Firestore stats if available
            self._apply_firestore_fields(user, fs)

            user.save()

            # Link Firebase uid
            from users.models import UserFirebaseProfile
            UserFirebaseProfile.objects.get_or_create(
                user         = user,
                defaults     = {'firebase_uid': uid},
            )

            self.stdout.write(self.style.SUCCESS(
                f'  CREATED: {username} <{email}> (uid={uid[:8]}…)'
            ))
            return 'created'

        # ── Update existing user ───────────────────────────────────────────
        changed = False

        # Keep email in sync
        if existing_user.email != email:
            if not dry_run:
                existing_user.email = email
            changed = True

        # Fill in display_name if blank
        if not existing_user.display_name and display_name:
            if not dry_run:
                existing_user.display_name = display_name
            changed = True

        # Ensure unusable password (Firebase users should never have a usable one)
        if existing_user.has_usable_password():
            if not dry_run:
                existing_user.set_unusable_password()
            changed = True

        if changed and not dry_run:
            existing_user.save(update_fields=['email', 'display_name', 'password'])

        # Ensure UserFirebaseProfile link exists
        if not dry_run:
            from users.models import UserFirebaseProfile
            UserFirebaseProfile.objects.get_or_create(
                firebase_uid = uid,
                defaults     = {'user': existing_user},
            )

        if changed:
            self.stdout.write(f'  UPDATED: {existing_user.username} <{email}>')
            return 'updated'

        return 'skipped'

    # ─────────────────────────────────────────────────────────────────────────
    #  Helpers
    # ─────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _apply_firestore_fields(user, fs: dict):
        """Copy safe Firestore profile fields onto a new User instance."""
        if not fs:
            return
        int_fields = [
            'prestige_points', 'level', 'current_streak',
            'total_submissions', 'successful_submissions', 'tournament_wins',
            'verification_level',
        ]
        str_fields = [
            'bio', 'location', 'website', 'power_rank', 'access_tier',
        ]
        bool_fields = ['is_verified']

        for f in int_fields:
            val = fs.get(f)
            if val is not None:
                try:
                    setattr(user, f, int(val))
                except (ValueError, TypeError):
                    pass

        for f in str_fields:
            val = fs.get(f)
            if val:
                setattr(user, f, str(val))

        for f in bool_fields:
            val = fs.get(f)
            if val is not None:
                setattr(user, f, bool(val))

        earnings = fs.get('total_earnings')
        if earnings is not None:
            try:
                user.total_earnings = float(earnings)
            except (ValueError, TypeError):
                pass

    @staticmethod
    def _username_from_email(email: str) -> str:
        """Derive a clean username from an email address."""
        base = email.split('@')[0]
        return re.sub(r'[^a-zA-Z0-9_]', '', base)[:30] or 'user'

    @staticmethod
    def _ensure_unique_username(username: str, exclude_uid: str = None) -> str:
        """Append a numeric suffix until the username is unique."""
        # Check if a user with this username already exists
        # and is NOT the same Firebase user we're syncing
        qs = User.objects.filter(username__iexact=username)
        if exclude_uid:
            try:
                from users.models import UserFirebaseProfile
                fp = UserFirebaseProfile.objects.get(firebase_uid=exclude_uid)
                qs = qs.exclude(pk=fp.user_id)
            except Exception:
                pass

        if not qs.exists():
            return username

        suffix = 1
        while True:
            candidate = f'{username[:27]}_{suffix}'
            if not User.objects.filter(username__iexact=candidate).exists():
                return candidate
            suffix += 1
