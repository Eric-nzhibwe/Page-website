"""
Firestore Alliance Service — Phase 7
=======================================
Full implementation of alliance data storage in Firestore.
The alliance views were all TODO stubs with no working ORM code,
so this becomes the ONLY backend — no dual-routing needed.

Firestore collection layout
---------------------------
  alliances/
    {alliance_id}/
      id                : str
      name              : str   — unique enforced client-side + Firestore rule
      tag               : str   — short tag e.g. ARTX
      description       : str
      logo_url          : str | null
      leader_id         : str
      leader_username   : str
      is_public         : bool
      requires_approval : bool
      min_tier          : str
      max_members       : int
      total_prestige    : int
      tournament_wins   : int
      level             : int
      member_count      : int   — denormalised for cheap list queries
      created_at        : Timestamp
      updated_at        : Timestamp

      members/           ← sub-collection
        {user_id}/
          user_id            : str
          username           : str
          avatar             : str | null
          tier               : str
          role               : str  — member|officer|leader
          status             : str  — pending|active|inactive|banned
          prestige_contributed : int
          joined_at          : Timestamp
          last_active        : Timestamp

      events/            ← sub-collection
        {event_id}/
          id          : str
          event_type  : str
          description : str
          user_id     : str | null
          username    : str | null
          metadata    : dict
          created_at  : Timestamp

  alliance_invitations/
    {invitation_id}/
      id            : str
      alliance_id   : str
      alliance_name : str
      alliance_tag  : str
      invited_user_id   : str
      invited_username  : str
      invited_by_id     : str
      invited_by_username : str
      message       : str
      status        : str  — pending|accepted|declined|expired
      created_at    : Timestamp
      expires_at    : Timestamp
      responded_at  : Timestamp | null

Required Firestore composite indexes:
  alliances
  ├── is_public ASC, total_prestige DESC   (public browse)
  └── total_prestige DESC                  (leaderboard)

  alliance_invitations
  └── invited_user_id ASC, status ASC, created_at DESC
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta

from artx_platform.firebase_client import get_firestore

logger       = logging.getLogger(__name__)
ALLIANCES    = 'alliances'
INVITATIONS  = 'alliance_invitations'


# ─────────────────────────────────────────────────────────────────────────────
#  Alliance CRUD
# ─────────────────────────────────────────────────────────────────────────────

def create_alliance(leader, name: str, tag: str, description: str = '',
                    logo_url: str = None, is_public: bool = True,
                    requires_approval: bool = False,
                    min_tier: str = 'Bronze', max_members: int = 50) -> dict:
    """
    Create a new alliance and add the leader as the first member.
    Returns the alliance dict, or raises ValueError on duplicate name/tag.
    """
    db = get_firestore()
    if db is None:
        raise RuntimeError('Firestore not available.')

    # Check uniqueness (Firestore has no UNIQUE constraint — check manually)
    existing_name = (db.collection(ALLIANCES)
                     .where('name', '==', name).limit(1).stream())
    if any(True for _ in existing_name):
        raise ValueError(f'An alliance named "{name}" already exists.')

    existing_tag = (db.collection(ALLIANCES)
                    .where('tag', '==', tag.upper()).limit(1).stream())
    if any(True for _ in existing_tag):
        raise ValueError(f'The tag "{tag}" is already taken.')

    alliance_id = str(uuid.uuid4())
    now         = datetime.now(tz=timezone.utc)

    doc = {
        'id':                alliance_id,
        'name':              name,
        'tag':               tag.upper(),
        'description':       description,
        'logo_url':          logo_url,
        'leader_id':         str(leader.id),
        'leader_username':   leader.username,
        'is_public':         is_public,
        'requires_approval': requires_approval,
        'min_tier':          min_tier,
        'max_members':       max_members,
        'total_prestige':    getattr(leader, 'prestige_points', 0),
        'tournament_wins':   0,
        'level':             1,
        'member_count':      1,
        'created_at':        now,
        'updated_at':        now,
    }

    try:
        alliance_ref = db.collection(ALLIANCES).document(alliance_id)
        alliance_ref.set(doc)

        # Add leader as first member
        _add_member_doc(alliance_ref, leader, role='leader', status='active', now=now)

        # Log creation event
        _add_event(alliance_ref, 'member_joined',
                   f'{leader.username} created the alliance',
                   user_id=str(leader.id), username=leader.username)

        return _fmt(doc)
    except Exception as exc:
        logger.error(f'Firestore create_alliance error: {exc}')
        raise


def get_alliance(alliance_id: str) -> dict | None:
    """Fetch a single alliance by ID."""
    db = get_firestore()
    if db is None:
        return None
    try:
        snap = db.collection(ALLIANCES).document(str(alliance_id)).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        d['id'] = snap.id
        return _fmt(d)
    except Exception as exc:
        logger.error(f'Firestore get_alliance error: {exc}')
        return None


def list_alliances(public_only: bool = True, limit: int = 50) -> list:
    """Return alliances sorted by prestige descending."""
    db = get_firestore()
    if db is None:
        return []
    try:
        q = db.collection(ALLIANCES)
        if public_only:
            q = q.where('is_public', '==', True)
        docs = q.order_by('total_prestige', direction='DESCENDING').limit(limit).stream()
        return [_fmt(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore list_alliances error: {exc}')
        return []


def get_user_alliance(user_id: str) -> dict | None:
    """
    Return the alliance the user is an active member of, or None.
    Searches the members sub-collection across all alliances — this is done
    via a collection group query on the 'members' sub-collection.
    """
    db = get_firestore()
    if db is None:
        return None
    try:
        # Collection group query — requires a single-field index on user_id
        # in the members sub-collection (Firebase creates this automatically
        # when you first run the query and it prompts you for the index).
        docs = (db.collection_group('members')
                .where('user_id', '==', str(user_id))
                .where('status', '==', 'active')
                .limit(1)
                .stream())
        for member_doc in docs:
            # The parent of the member doc is the alliance doc
            alliance_ref = member_doc.reference.parent.parent
            snap         = alliance_ref.get()
            if snap.exists:
                d = snap.to_dict()
                d['id'] = snap.id
                return _fmt(d)
        return None
    except Exception as exc:
        logger.error(f'Firestore get_user_alliance error: {exc}')
        return None


# ─────────────────────────────────────────────────────────────────────────────
#  Membership
# ─────────────────────────────────────────────────────────────────────────────

def join_alliance(alliance_id: str, user) -> dict:
    """
    Join a public alliance directly (or create a pending request if
    requires_approval is True).
    Returns the membership dict or raises ValueError.
    """
    db = get_firestore()
    if db is None:
        raise RuntimeError('Firestore not available.')

    alliance = get_alliance(alliance_id)
    if alliance is None:
        raise ValueError('Alliance not found.')
    if alliance['member_count'] >= alliance['max_members']:
        raise ValueError('Alliance is full.')

    status = 'pending' if alliance.get('requires_approval') else 'active'
    now    = datetime.now(tz=timezone.utc)

    try:
        alliance_ref = db.collection(ALLIANCES).document(str(alliance_id))
        membership   = _add_member_doc(alliance_ref, user,
                                       role='member', status=status, now=now)
        if status == 'active':
            _increment_member_count(alliance_ref, 1)
            _update_prestige(alliance_ref,
                             getattr(user, 'prestige_points', 0))
            _add_event(alliance_ref, 'member_joined',
                       f'{user.username} joined the alliance',
                       user_id=str(user.id), username=user.username)
        return membership
    except Exception as exc:
        logger.error(f'Firestore join_alliance error: {exc}')
        raise


def leave_alliance(alliance_id: str, user) -> bool:
    """Remove a member from an alliance."""
    db = get_firestore()
    if db is None:
        return False
    try:
        alliance_ref = db.collection(ALLIANCES).document(str(alliance_id))
        member_ref   = alliance_ref.collection('members').document(str(user.id))
        snap         = member_ref.get()
        if not snap.exists:
            return False
        member_ref.delete()
        _increment_member_count(alliance_ref, -1)
        _add_event(alliance_ref, 'member_left',
                   f'{user.username} left the alliance',
                   user_id=str(user.id), username=user.username)
        return True
    except Exception as exc:
        logger.error(f'Firestore leave_alliance error: {exc}')
        return False


def get_members(alliance_id: str) -> list:
    """Return all active members of an alliance."""
    db = get_firestore()
    if db is None:
        return []
    try:
        docs = (db.collection(ALLIANCES)
                .document(str(alliance_id))
                .collection('members')
                .where('status', '==', 'active')
                .order_by('prestige_contributed', direction='DESCENDING')
                .stream())
        return [_fmt_member(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_members error: {exc}')
        return []


def promote_member(alliance_id: str, user_id: str, role: str = 'officer') -> bool:
    """Change a member's role (officer or back to member)."""
    db = get_firestore()
    if db is None:
        return False
    try:
        ref = (db.collection(ALLIANCES)
               .document(str(alliance_id))
               .collection('members')
               .document(str(user_id)))
        snap = ref.get()
        if not snap.exists:
            return False
        ref.update({'role': role, 'last_active': datetime.now(tz=timezone.utc)})
        return True
    except Exception as exc:
        logger.error(f'Firestore promote_member error: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Invitations
# ─────────────────────────────────────────────────────────────────────────────

def send_invitation(alliance_id: str, invited_user, invited_by,
                    message: str = '') -> dict:
    """Send an invitation to a user.  Expires in 7 days."""
    db = get_firestore()
    if db is None:
        raise RuntimeError('Firestore not available.')

    alliance = get_alliance(alliance_id)
    if alliance is None:
        raise ValueError('Alliance not found.')

    # Check no pending invite already exists
    existing = (db.collection(INVITATIONS)
                .where('alliance_id',     '==', str(alliance_id))
                .where('invited_user_id', '==', str(invited_user.id))
                .where('status',          '==', 'pending')
                .limit(1)
                .stream())
    if any(True for _ in existing):
        raise ValueError('A pending invitation already exists for this user.')

    inv_id = str(uuid.uuid4())
    now    = datetime.now(tz=timezone.utc)
    doc    = {
        'id':                   inv_id,
        'alliance_id':          str(alliance_id),
        'alliance_name':        alliance['name'],
        'alliance_tag':         alliance['tag'],
        'invited_user_id':      str(invited_user.id),
        'invited_username':     invited_user.username,
        'invited_by_id':        str(invited_by.id),
        'invited_by_username':  invited_by.username,
        'message':              message,
        'status':               'pending',
        'created_at':           now,
        'expires_at':           now + timedelta(days=7),
        'responded_at':         None,
    }
    try:
        db.collection(INVITATIONS).document(inv_id).set(doc)
        return _fmt_invitation(doc)
    except Exception as exc:
        logger.error(f'Firestore send_invitation error: {exc}')
        raise


def get_user_invitations(user_id: str) -> list:
    """Return all pending invitations for a user."""
    db = get_firestore()
    if db is None:
        return []
    try:
        docs = (db.collection(INVITATIONS)
                .where('invited_user_id', '==', str(user_id))
                .where('status', '==', 'pending')
                .order_by('created_at', direction='DESCENDING')
                .stream())
        now  = datetime.now(tz=timezone.utc)
        results = []
        for doc in docs:
            d = doc.to_dict()
            d['id'] = doc.id
            # Auto-expire past invitations
            expires = _to_dt(d.get('expires_at'))
            if expires and now > expires:
                doc.reference.update({'status': 'expired'})
                continue
            results.append(_fmt_invitation(d))
        return results
    except Exception as exc:
        logger.error(f'Firestore get_user_invitations error: {exc}')
        return []


def respond_to_invitation(invitation_id: str, user, accept: bool) -> dict:
    """Accept or decline an invitation."""
    db = get_firestore()
    if db is None:
        raise RuntimeError('Firestore not available.')

    ref  = db.collection(INVITATIONS).document(str(invitation_id))
    snap = ref.get()
    if not snap.exists:
        raise ValueError('Invitation not found.')

    d = snap.to_dict()
    if d.get('invited_user_id') != str(user.id):
        raise ValueError('This invitation is not for you.')
    if d.get('status') != 'pending':
        raise ValueError(f'Invitation is already {d["status"]}.')

    now     = datetime.now(tz=timezone.utc)
    expires = _to_dt(d.get('expires_at'))
    if expires and now > expires:
        ref.update({'status': 'expired'})
        raise ValueError('Invitation has expired.')

    new_status = 'accepted' if accept else 'declined'
    ref.update({'status': new_status, 'responded_at': now})

    if accept:
        join_alliance(d['alliance_id'], user)

    d['status']       = new_status
    d['responded_at'] = now
    return _fmt_invitation(d)


# ─────────────────────────────────────────────────────────────────────────────
#  Events
# ─────────────────────────────────────────────────────────────────────────────

def get_events(alliance_id: str, limit: int = 50) -> list:
    """Return recent alliance events."""
    db = get_firestore()
    if db is None:
        return []
    try:
        docs = (db.collection(ALLIANCES)
                .document(str(alliance_id))
                .collection('events')
                .order_by('created_at', direction='DESCENDING')
                .limit(limit)
                .stream())
        return [_fmt_event(d.to_dict() | {'id': d.id}) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_events error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helper
# ─────────────────────────────────────────────────────────────────────────────

def migrate_from_postgres(alliance_qs):
    """
    One-time migration.

    Usage:
        from alliances.models import Alliance
        from alliances.firestore_alliance_service import migrate_from_postgres
        migrate_from_postgres(
            Alliance.objects.prefetch_related(
                'members__user', 'events__user'
            ).select_related('leader')
        )
    """
    db = get_firestore()
    if db is None:
        logger.error('migrate alliances: Firestore not available.')
        return 0

    BATCH_SIZE = 300
    migrated   = 0
    batch      = db.batch()
    count      = 0

    def _flush():
        nonlocal batch, count
        if count:
            batch.commit()
            batch = db.batch()
            count = 0

    for alliance in alliance_qs.iterator():
        a_id  = str(alliance.id)
        a_ref = db.collection(ALLIANCES).document(a_id)
        now   = datetime.now(tz=timezone.utc)

        a_doc = {
            'id':                a_id,
            'name':              alliance.name,
            'tag':               alliance.tag,
            'description':       alliance.description or '',
            'logo_url':          alliance.logo.url if alliance.logo else None,
            'leader_id':         str(alliance.leader_id),
            'leader_username':   alliance.leader.username,
            'is_public':         alliance.is_public,
            'requires_approval': alliance.requires_approval,
            'min_tier':          alliance.min_tier,
            'max_members':       alliance.max_members,
            'total_prestige':    alliance.total_prestige,
            'tournament_wins':   alliance.tournament_wins,
            'level':             alliance.level,
            'member_count':      alliance.members.filter(status='active').count(),
            'created_at':        alliance.created_at,
            'updated_at':        alliance.updated_at,
            '_pg_id':            a_id,
        }
        batch.set(a_ref, a_doc)
        count    += 1
        migrated += 1
        if count >= BATCH_SIZE:
            _flush()

        for membership in alliance.members.select_related('user').all():
            m_ref = a_ref.collection('members').document(str(membership.user_id))
            batch.set(m_ref, {
                'user_id':               str(membership.user_id),
                'username':              membership.user.username,
                'avatar':                None,
                'tier':                  getattr(membership.user, 'access_tier', 'Bronze'),
                'role':                  membership.role,
                'status':                membership.status,
                'prestige_contributed':  membership.prestige_contributed,
                'joined_at':             membership.joined_at,
                'last_active':           membership.last_active,
            })
            count    += 1
            migrated += 1
            if count >= BATCH_SIZE:
                _flush()

        for event in alliance.events.select_related('user').all():
            e_ref = a_ref.collection('events').document(str(event.id))
            batch.set(e_ref, {
                'id':          str(event.id),
                'event_type':  event.event_type,
                'description': event.description,
                'user_id':     str(event.user_id) if event.user_id else None,
                'username':    event.user.username if event.user else None,
                'metadata':    event.metadata or {},
                'created_at':  event.created_at,
            })
            count    += 1
            migrated += 1
            if count >= BATCH_SIZE:
                _flush()

    _flush()
    logger.info(f'migrate alliances: done — {migrated} documents written.')
    return migrated


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _add_member_doc(alliance_ref, user, role: str, status: str, now) -> dict:
    doc = {
        'user_id':               str(user.id),
        'username':              user.username,
        'avatar':                None,
        'tier':                  getattr(user, 'access_tier', 'Bronze'),
        'role':                  role,
        'status':                status,
        'prestige_contributed':  getattr(user, 'prestige_points', 0),
        'joined_at':             now,
        'last_active':           now,
    }
    alliance_ref.collection('members').document(str(user.id)).set(doc)
    return _fmt_member(doc)


def _add_event(alliance_ref, event_type: str, description: str,
               user_id: str = None, username: str = None, metadata: dict = None):
    event_id = str(uuid.uuid4())
    alliance_ref.collection('events').document(event_id).set({
        'id':          event_id,
        'event_type':  event_type,
        'description': description,
        'user_id':     user_id,
        'username':    username,
        'metadata':    metadata or {},
        'created_at':  datetime.now(tz=timezone.utc),
    })


def _increment_member_count(alliance_ref, delta: int):
    try:
        from google.cloud.firestore_v1 import Increment
        alliance_ref.update({
            'member_count': Increment(delta),
            'updated_at':   datetime.now(tz=timezone.utc),
        })
    except Exception as exc:
        logger.error(f'_increment_member_count error: {exc}')


def _update_prestige(alliance_ref, prestige_delta: int):
    try:
        from google.cloud.firestore_v1 import Increment
        alliance_ref.update({
            'total_prestige': Increment(prestige_delta),
            'updated_at':     datetime.now(tz=timezone.utc),
        })
    except Exception as exc:
        logger.error(f'_update_prestige error: {exc}')


def _to_dt(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if hasattr(val, 'timestamp'):
        return datetime.fromtimestamp(val.timestamp(), tz=timezone.utc)
    return None


def _ts(val) -> str | None:
    dt = _to_dt(val)
    return dt.isoformat() if dt else None


def _fmt(d: dict) -> dict:
    return {
        'id':                d.get('id', ''),
        'name':              d.get('name', ''),
        'tag':               d.get('tag', ''),
        'description':       d.get('description', ''),
        'logo_url':          d.get('logo_url'),
        'leader_id':         d.get('leader_id', ''),
        'leader_username':   d.get('leader_username', ''),
        'is_public':         d.get('is_public', True),
        'requires_approval': d.get('requires_approval', False),
        'min_tier':          d.get('min_tier', 'Bronze'),
        'max_members':       d.get('max_members', 50),
        'total_prestige':    d.get('total_prestige', 0),
        'tournament_wins':   d.get('tournament_wins', 0),
        'level':             d.get('level', 1),
        'member_count':      d.get('member_count', 0),
        'created_at':        _ts(d.get('created_at')),
        'updated_at':        _ts(d.get('updated_at')),
    }


def _fmt_member(d: dict) -> dict:
    return {
        'user_id':              d.get('user_id', ''),
        'username':             d.get('username', ''),
        'avatar':               d.get('avatar'),
        'tier':                 d.get('tier', 'Bronze'),
        'role':                 d.get('role', 'member'),
        'status':               d.get('status', 'active'),
        'prestige_contributed': d.get('prestige_contributed', 0),
        'joined_at':            _ts(d.get('joined_at')),
        'last_active':          _ts(d.get('last_active')),
    }


def _fmt_event(d: dict) -> dict:
    return {
        'id':          d.get('id', ''),
        'event_type':  d.get('event_type', ''),
        'description': d.get('description', ''),
        'user_id':     d.get('user_id'),
        'username':    d.get('username'),
        'metadata':    d.get('metadata', {}),
        'created_at':  _ts(d.get('created_at')),
    }


def _fmt_invitation(d: dict) -> dict:
    return {
        'id':                   d.get('id', ''),
        'alliance_id':          d.get('alliance_id', ''),
        'alliance_name':        d.get('alliance_name', ''),
        'alliance_tag':         d.get('alliance_tag', ''),
        'invited_user_id':      d.get('invited_user_id', ''),
        'invited_username':     d.get('invited_username', ''),
        'invited_by_id':        d.get('invited_by_id', ''),
        'invited_by_username':  d.get('invited_by_username', ''),
        'message':              d.get('message', ''),
        'status':               d.get('status', 'pending'),
        'created_at':           _ts(d.get('created_at')),
        'expires_at':           _ts(d.get('expires_at')),
        'responded_at':         _ts(d.get('responded_at')),
    }
