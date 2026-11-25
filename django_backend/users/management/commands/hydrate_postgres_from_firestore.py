"""
Management command: hydrate_postgres_from_firestore
====================================================
Step 3 of the uid-link strategy.

When Render's free Postgres expires and you attach a brand-new empty
database, run this command once to rebuild ALL tables from their Firestore
mirrors. No manual data-copying required.

Restore order (honours foreign-key dependencies):
  1. users           ← user_profiles  (always first; everything else FKs to users)
  2. challenges      ← challenges
  3. alliances       ← alliances + alliances/{id}/members sub-collection
  4. social posts    ← social_posts (and comments stored inline)

NOT restored from Firestore:
  • Wallets / Transactions — Postgres is the financial source of truth.
    Firestore only holds read-only mirrors. Re-creating wallet rows from
    those mirrors risks stale balances. Wallets are recreated automatically
    by a post_save signal when the user row is created (see payments/signals.py).
  • Challenge submissions — stored in challenge_submissions Firestore collection
    but can be re-linked only after both users and challenges exist; use
    `python manage.py migrate_submissions_to_firestore` in reverse if needed.

Usage:
    # Preview what would be restored (no writes)
    python manage.py hydrate_postgres_from_firestore --dry-run

    # Full restore
    python manage.py hydrate_postgres_from_firestore

    # Restore only specific sections
    python manage.py hydrate_postgres_from_firestore --only users
    python manage.py hydrate_postgres_from_firestore --only challenges
    python manage.py hydrate_postgres_from_firestore --only alliances
    python manage.py hydrate_postgres_from_firestore --only social

    # Limit rows per section (useful for smoke-testing)
    python manage.py hydrate_postgres_from_firestore --limit 20
"""

import logging
from datetime import datetime, timezone as dt_timezone

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)
User   = get_user_model()

VALID_SECTIONS = ('users', 'challenges', 'alliances', 'social')


# ─────────────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(val):
    """Coerce a Firestore Timestamp / ISO string / None → aware datetime."""
    if val is None:
        return timezone.now()
    if hasattr(val, 'timestamp'):                # Firestore Timestamp object
        return datetime.fromtimestamp(val.timestamp(), tz=dt_timezone.utc)
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace('Z', '+00:00'))
        except ValueError:
            return timezone.now()
    return timezone.now()


def _decimal(val, default='0.00'):
    from decimal import Decimal, InvalidOperation
    try:
        return Decimal(str(val))
    except (InvalidOperation, TypeError):
        return Decimal(default)


def _int(val, default=0):
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _str(val, default=''):
    return str(val) if val is not None else default


# ─────────────────────────────────────────────────────────────────────────────
#  Command
# ─────────────────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = (
        'Restore Postgres tables from Firestore mirrors after a database expiry. '
        'Run once against a fresh empty database — safe to re-run (idempotent).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            default=False,
            help='Preview counts without writing anything.',
        )
        parser.add_argument(
            '--only',
            choices=VALID_SECTIONS,
            default=None,
            help='Restore only one section (users | challenges | alliances | social).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=0,
            help='Cap rows per section at this number (0 = no cap). Good for smoke tests.',
        )

    # ─────────────────────────────────────────────────────────────────────
    #  Entry point
    # ─────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        only    = options['only']
        limit   = options['limit']

        if dry_run:
            self.stdout.write(self.style.WARNING(
                'DRY RUN — no writes will be performed.\n'
            ))

        # ── Verify Firebase ───────────────────────────────────────────────
        try:
            from page_platform.firebase_client import firebase_enabled, get_firestore
            if not firebase_enabled():
                self.stdout.write(self.style.ERROR(
                    'Firebase not configured — set FIREBASE_SERVICE_ACCOUNT_JSON '
                    'in your environment and try again.'
                ))
                return
            db = get_firestore()
            if db is None:
                self.stdout.write(self.style.ERROR('Firestore client unavailable.'))
                return
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'Firebase init error: {exc}'))
            return

        self._db = db

        # ── Run sections in dependency order ──────────────────────────────
        totals = {}

        sections = [only] if only else list(VALID_SECTIONS)

        # Users must always come first when restoring multiple sections
        if 'users' in sections:
            sections.remove('users')
            sections.insert(0, 'users')

        for section in sections:
            self.stdout.write(f'\n{"─"*60}')
            self.stdout.write(f'==> Restoring: {section}')
            handler = getattr(self, f'_restore_{section}')
            totals[section] = handler(dry_run=dry_run, limit=limit)

        # ── Summary ───────────────────────────────────────────────────────
        self.stdout.write(f'\n{"─"*60}')
        prefix = '[DRY RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(f'\n{prefix}Hydration complete:'))
        for section, (created, updated, skipped, errors) in totals.items():
            self.stdout.write(
                f'  {section:<12}  created={created}  updated={updated}  '
                f'skipped={skipped}  errors={errors}'
            )

        if not dry_run:
            self.stdout.write(self.style.SUCCESS(
                '\nPostgres successfully restored from Firestore!\n'
                'Next steps:\n'
                '  1. Verify row counts in Django admin\n'
                '  2. Run python manage.py rekey_firestore_to_uid  '
                '(if not already done)\n'
                '  3. Redeploy — dual-write keeps both stores in sync going forward'
            ))

    # ─────────────────────────────────────────────────────────────────────
    #  Section: users
    #
    #  Delegates entirely to restore_users_from_firebase which already
    #  handles Firebase Auth + Firestore user_profiles → Django User rows.
    # ─────────────────────────────────────────────────────────────────────

    def _restore_users(self, dry_run, limit):
        self.stdout.write('  Source: Firebase Auth + user_profiles Firestore collection')
        from django.core.management import call_command
        from io import StringIO

        out = StringIO()
        call_command(
            'restore_users_from_firebase',
            dry_run=dry_run,
            limit=limit,
            stdout=out,
        )
        output = out.getvalue()
        for line in output.splitlines():
            self.stdout.write(f'  {line}')

        # Parse the summary line to return standardised counts
        created = updated = skipped = errors = 0
        for line in output.splitlines():
            if 'created=' in line:
                import re
                m = re.search(
                    r'created=(\d+).*updated=(\d+).*skipped=(\d+).*errors=(\d+)',
                    line
                )
                if m:
                    created, updated, skipped, errors = (int(x) for x in m.groups())
        return created, updated, skipped, errors

    # ─────────────────────────────────────────────────────────────────────
    #  Section: challenges
    # ─────────────────────────────────────────────────────────────────────

    def _restore_challenges(self, dry_run, limit):
        from challenges.models import Challenge

        self.stdout.write('  Source: challenges Firestore collection')

        try:
            docs = list(self._db.collection('challenges').stream())
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'  Firestore read failed: {exc}'))
            return 0, 0, 0, 1

        if limit:
            docs = docs[:limit]

        self.stdout.write(f'  Found {len(docs)} challenge documents')

        created = updated = skipped = errors = 0

        for doc in docs:
            d = doc.to_dict()
            cid = d.get('id') or doc.id

            try:
                # Resolve creator
                creator = None
                created_by_id = d.get('created_by_id')
                if created_by_id:
                    try:
                        from users.models import UserFirebaseProfile
                        fp = UserFirebaseProfile.objects.select_related('user').get(
                            firebase_uid=created_by_id
                        )
                        creator = fp.user
                    except Exception:
                        try:
                            creator = User.objects.get(pk=created_by_id)
                        except Exception:
                            pass

                fields = dict(
                    title            = _str(d.get('title'), 'Untitled'),
                    description      = _str(d.get('description')),
                    image_url        = _str(d.get('image_url')),
                    challenge_type   = _str(d.get('challenge_type'), 'text_interpretation'),
                    hidden_points    = d.get('hidden_points') or [],
                    prize_amount     = _decimal(d.get('prize_amount')),
                    entry_fee        = _decimal(d.get('entry_fee')),
                    difficulty       = _str(d.get('difficulty'), 'medium'),
                    time_limit       = _int(d.get('time_limit'), 60),
                    min_word_count   = _int(d.get('min_word_count'), 50),
                    max_word_count   = _int(d.get('max_word_count'), 500),
                    submission_rules = d.get('submission_rules') or [],
                    creativity_weight= _int(d.get('creativity_weight'), 40),
                    relevance_weight = _int(d.get('relevance_weight'), 35),
                    detail_weight    = _int(d.get('detail_weight'), 25),
                    min_points       = _int(d.get('min_points'), 10),
                    max_points       = _int(d.get('max_points'), 50),
                    status           = _str(d.get('status'), 'active'),
                    is_featured      = bool(d.get('is_featured', False)),
                    view_count       = _int(d.get('view_count')),
                    submission_count = _int(d.get('submission_count')),
                    created_by       = creator,
                    starts_at        = _ts(d.get('starts_at')),
                    ends_at          = _ts(d.get('ends_at')),
                )

                if dry_run:
                    self.stdout.write(
                        f'  [DRY RUN] Would upsert challenge: {fields["title"][:50]}'
                    )
                    created += 1
                    continue

                with transaction.atomic():
                    obj, is_new = Challenge.objects.update_or_create(
                        id=cid,
                        defaults=fields,
                    )
                if is_new:
                    created += 1
                else:
                    updated += 1

            except Exception as exc:
                errors += 1
                logger.error(f'hydrate challenges: error on doc={cid}: {exc}')
                self.stdout.write(self.style.ERROR(f'  ERROR doc={cid}: {exc}'))

        self.stdout.write(
            f'  challenges done — created={created} updated={updated} '
            f'skipped={skipped} errors={errors}'
        )
        return created, updated, skipped, errors

    # ─────────────────────────────────────────────────────────────────────
    #  Section: alliances
    # ─────────────────────────────────────────────────────────────────────

    def _restore_alliances(self, dry_run, limit):
        from alliances.models import Alliance, AllianceMembership

        self.stdout.write('  Source: alliances Firestore collection')

        try:
            docs = list(self._db.collection('alliances').stream())
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'  Firestore read failed: {exc}'))
            return 0, 0, 0, 1

        if limit:
            docs = docs[:limit]

        self.stdout.write(f'  Found {len(docs)} alliance documents')

        created = updated = skipped = errors = 0
        member_created = 0

        for doc in docs:
            d = doc.to_dict()
            aid = d.get('id') or doc.id

            try:
                # Resolve leader
                leader = None
                leader_id = d.get('leader_id')
                if leader_id:
                    try:
                        from users.models import UserFirebaseProfile
                        fp = UserFirebaseProfile.objects.select_related('user').get(
                            firebase_uid=leader_id
                        )
                        leader = fp.user
                    except Exception:
                        try:
                            leader = User.objects.get(pk=leader_id)
                        except Exception:
                            pass

                if leader is None:
                    self.stdout.write(
                        self.style.WARNING(f'  SKIP alliance={aid[:8]} — leader not found')
                    )
                    skipped += 1
                    continue

                fields = dict(
                    name             = _str(d.get('name'), f'Alliance_{aid[:8]}'),
                    tag              = _str(d.get('tag'), aid[:8]),
                    description      = _str(d.get('description')),
                    leader           = leader,
                    is_public        = bool(d.get('is_public', True)),
                    requires_approval= bool(d.get('requires_approval', False)),
                    min_tier         = _str(d.get('min_tier'), 'Bronze'),
                    max_members      = _int(d.get('max_members'), 50),
                    total_prestige   = _int(d.get('total_prestige')),
                    tournament_wins  = _int(d.get('tournament_wins')),
                    level            = _int(d.get('level'), 1),
                )

                if dry_run:
                    self.stdout.write(
                        f'  [DRY RUN] Would upsert alliance: {fields["name"]}'
                    )
                    created += 1
                    continue

                with transaction.atomic():
                    obj, is_new = Alliance.objects.update_or_create(
                        name=fields['name'],
                        defaults=fields,
                    )

                if is_new:
                    created += 1
                else:
                    updated += 1

                # ── Restore members sub-collection ────────────────────────
                try:
                    member_docs = list(
                        self._db.collection('alliances')
                        .document(doc.id)
                        .collection('members')
                        .stream()
                    )
                    for mdoc in member_docs:
                        md = mdoc.to_dict()
                        member_uid = md.get('user_id') or mdoc.id
                        try:
                            from users.models import UserFirebaseProfile
                            mfp = UserFirebaseProfile.objects.select_related('user').get(
                                firebase_uid=member_uid
                            )
                            muser = mfp.user
                        except Exception:
                            continue

                        _, m_new = AllianceMembership.objects.get_or_create(
                            alliance=obj,
                            user=muser,
                            defaults={
                                'role':   _str(md.get('role'), 'member'),
                                'status': _str(md.get('status'), 'active'),
                            },
                        )
                        if m_new:
                            member_created += 1
                except Exception as mexc:
                    logger.warning(f'hydrate alliances: member restore failed for {aid}: {mexc}')

            except Exception as exc:
                errors += 1
                logger.error(f'hydrate alliances: error on doc={aid}: {exc}')
                self.stdout.write(self.style.ERROR(f'  ERROR doc={aid}: {exc}'))

        self.stdout.write(
            f'  alliances done — created={created} updated={updated} '
            f'skipped={skipped} errors={errors}  members_created={member_created}'
        )
        return created, updated, skipped, errors

    # ─────────────────────────────────────────────────────────────────────
    #  Section: social
    # ─────────────────────────────────────────────────────────────────────

    def _restore_social(self, dry_run, limit):
        from social.models import Post, Comment

        self.stdout.write('  Source: social_posts Firestore collection')

        try:
            docs = list(self._db.collection('social_posts').stream())
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'  Firestore read failed: {exc}'))
            return 0, 0, 0, 1

        if limit:
            docs = docs[:limit]

        self.stdout.write(f'  Found {len(docs)} post documents')

        created = updated = skipped = errors = 0

        for doc in docs:
            d = doc.to_dict()
            pid = d.get('id') or doc.id

            try:
                # Resolve author
                author = None
                author_uid = d.get('author_id') or d.get('firebase_uid')
                if author_uid:
                    try:
                        from users.models import UserFirebaseProfile
                        fp = UserFirebaseProfile.objects.select_related('user').get(
                            firebase_uid=author_uid
                        )
                        author = fp.user
                    except Exception:
                        pass

                if author is None:
                    skipped += 1
                    continue

                fields = dict(
                    author      = author,
                    content     = _str(d.get('content')),
                    post_type   = _str(d.get('post_type'), 'text'),
                    media_url   = d.get('media_url') or None,
                    media_type  = _str(d.get('media_type')),
                    achievement_badge = d.get('achievement_badge') or {},
                    challenge_id      = _str(d.get('challenge_id')),
                    reaction_count    = _int(d.get('reaction_count')),
                    comment_count     = _int(d.get('comment_count')),
                    share_count       = _int(d.get('share_count')),
                )

                if dry_run:
                    self.stdout.write(
                        f'  [DRY RUN] Would upsert post: {pid[:8]}… '
                        f'by {author.username}'
                    )
                    created += 1
                    continue

                with transaction.atomic():
                    obj, is_new = Post.objects.update_or_create(
                        id=pid,
                        defaults=fields,
                    )
                if is_new:
                    created += 1
                else:
                    updated += 1

                # ── Restore inline comments ───────────────────────────────
                for comment_data in (d.get('comments') or []):
                    comment_uid = comment_data.get('author_id')
                    if not comment_uid:
                        continue
                    try:
                        from users.models import UserFirebaseProfile
                        cfp = UserFirebaseProfile.objects.select_related('user').get(
                            firebase_uid=comment_uid
                        )
                        Comment.objects.get_or_create(
                            id=comment_data.get('id', str(obj.pk)),
                            defaults=dict(
                                post    = obj,
                                author  = cfp.user,
                                content = _str(comment_data.get('content')),
                            ),
                        )
                    except Exception:
                        pass

            except Exception as exc:
                errors += 1
                logger.error(f'hydrate social: error on doc={pid}: {exc}')
                self.stdout.write(self.style.ERROR(f'  ERROR doc={pid}: {exc}'))

        self.stdout.write(
            f'  social done — created={created} updated={updated} '
            f'skipped={skipped} errors={errors}'
        )
        return created, updated, skipped, errors
