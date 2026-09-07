"""
Firestore Submission Service — Phase 5
========================================
Drop-in replacement for ChallengeSubmission and ImageInterpretationSubmission
PostgreSQL queries.  Used by challenges/views.py and challenges/serializers.py
when settings.FIRESTORE_COLLECTIONS['submissions'] is True.

Firestore collection layout
---------------------------
  challenge_submissions/
    {submission_id}/            ← UUID string
      id                      : str
      challenge_id            : str
      challenge_title         : str   ← denormalised
      user_id                 : str
      username                : str   ← denormalised
      submission_type         : str   — text | image
      interpretation          : str   ← text submissions only
      word_count              : int   ← text submissions only
      discovered_points       : list  ← image submissions only
      overall_message         : str   ← image submissions only
      submission_time_seconds : int
      status                  : str   — submitted|scoring|scored|rejected
      creativity_score        : int   ← text only
      relevance_score         : int   ← text only
      detail_score            : int   ← text only
      observation_score       : int   ← image only
      interpretation_score    : int   ← image only
      final_score             : int
      points_earned           : int
      prize_awarded           : float
      ai_feedback             : str
      submitted_at            : Timestamp
      scored_at               : Timestamp | null

Required Firestore composite indexes
(Firebase Console → Firestore → Indexes → Composite):

  challenge_submissions
  ├── user_id ASC, submitted_at DESC         (my submissions)
  ├── challenge_id ASC, status ASC, final_score DESC   (leaderboard)
  └── challenge_id ASC, submitted_at DESC    (challenge feed)
"""

import logging
import uuid
from datetime import datetime, timezone

from artx_platform.firebase_client import get_firestore

logger     = logging.getLogger(__name__)
COLLECTION = 'challenge_submissions'


# ─────────────────────────────────────────────────────────────────────────────
#  Write
# ─────────────────────────────────────────────────────────────────────────────

def save_text_submission(user, challenge, validated_data: dict,
                         score_result: dict = None) -> dict:
    """
    Persist a text interpretation submission document.
    `score_result` comes from text_scoring_service.score_text_interpretation().
    Returns the saved document dict.
    """
    db = get_firestore()
    if db is None:
        return {}

    sub_id = str(uuid.uuid4())
    now    = datetime.now(tz=timezone.utc)

    doc = {
        'id':                      sub_id,
        'challenge_id':            str(challenge.id),
        'challenge_title':         challenge.title,
        'user_id':                 str(user.id),
        'username':                user.username,
        'submission_type':         'text',
        'interpretation':          validated_data.get('interpretation', ''),
        'word_count':              validated_data.get('word_count', 0),
        'discovered_points':       [],
        'overall_message':         '',
        'submission_time_seconds': validated_data.get('submission_time_seconds', 0),
        'status':                  'submitted',
        'creativity_score':        0,
        'relevance_score':         0,
        'detail_score':            0,
        'observation_score':       0,
        'interpretation_score':    0,
        'final_score':             0,
        'points_earned':           0,
        'prize_awarded':           0.0,
        'ai_feedback':             '',
        'submitted_at':            now,
        'scored_at':               None,
    }

    if score_result:
        doc.update({
            'creativity_score': score_result.get('creativity_score', 0),
            'relevance_score':  score_result.get('relevance_score', 0),
            'detail_score':     score_result.get('detail_score', 0),
            'final_score':      score_result.get('final_score', 0),
            'points_earned':    score_result.get('final_score', 0),
            'ai_feedback':      score_result.get('ai_feedback', ''),
            'status':           'scored',
            'scored_at':        now,
        })

    try:
        db.collection(COLLECTION).document(sub_id).set(doc)
        return _fmt(doc)
    except Exception as exc:
        logger.error(f'Firestore save_text_submission error: {exc}')
        return {}


def save_image_submission(user, challenge, validated_data: dict,
                          score_result: dict = None) -> dict:
    """
    Persist an image interpretation submission document.
    `score_result` comes from scoring_service.score_image_interpretation().
    Returns the saved document dict.
    """
    db = get_firestore()
    if db is None:
        return {}

    import json as _json

    sub_id = str(uuid.uuid4())
    now    = datetime.now(tz=timezone.utc)

    doc = {
        'id':                      sub_id,
        'challenge_id':            str(challenge.id),
        'challenge_title':         challenge.title,
        'user_id':                 str(user.id),
        'username':                user.username,
        'submission_type':         'image',
        'interpretation':          '',
        'word_count':              0,
        'discovered_points':       validated_data.get('discovered_points', []),
        'overall_message':         validated_data.get('overall_message', ''),
        'submission_time_seconds': validated_data.get('submission_time_seconds', 0),
        'status':                  'submitted',
        'creativity_score':        0,
        'relevance_score':         0,
        'detail_score':            0,
        'observation_score':       0,
        'interpretation_score':    0,
        'final_score':             0,
        'points_earned':           0,
        'prize_awarded':           0.0,
        'ai_feedback':             '',
        'submitted_at':            now,
        'scored_at':               None,
    }

    if score_result:
        ai_fb = _json.dumps({
            'summary':       score_result.get('ai_feedback', ''),
            'point_results': score_result.get('point_results', []),
        })
        # Calculate final score (60% obs + 40% interp mapped to points range)
        obs   = score_result.get('observation_score', 0)
        interp = score_result.get('interpretation_score', 0)
        weighted = (obs * 0.60) + (interp * 0.40)
        pts_range = challenge.max_points - challenge.min_points
        final = int(challenge.min_points + (weighted / 100) * pts_range)

        doc.update({
            'observation_score':    obs,
            'interpretation_score': interp,
            'final_score':          final,
            'points_earned':        final,
            'ai_feedback':          ai_fb,
            'status':               'scored',
            'scored_at':            now,
        })

    try:
        db.collection(COLLECTION).document(sub_id).set(doc)
        return _fmt(doc)
    except Exception as exc:
        logger.error(f'Firestore save_image_submission error: {exc}')
        return {}


def update_submission_score(submission_id: str, score_result: dict,
                             submission_type: str = 'text') -> bool:
    """Update scoring fields on an existing document (async scoring path)."""
    db = get_firestore()
    if db is None:
        return False

    import json as _json
    now    = datetime.now(tz=timezone.utc)
    update = {'status': 'scored', 'scored_at': now}

    if submission_type == 'text':
        update.update({
            'creativity_score': score_result.get('creativity_score', 0),
            'relevance_score':  score_result.get('relevance_score', 0),
            'detail_score':     score_result.get('detail_score', 0),
            'final_score':      score_result.get('final_score', 0),
            'points_earned':    score_result.get('final_score', 0),
            'ai_feedback':      score_result.get('ai_feedback', ''),
        })
    else:
        ai_fb = _json.dumps({
            'summary':       score_result.get('ai_feedback', ''),
            'point_results': score_result.get('point_results', []),
        })
        update.update({
            'observation_score':    score_result.get('observation_score', 0),
            'interpretation_score': score_result.get('interpretation_score', 0),
            'final_score':          score_result.get('final_score', 0),
            'points_earned':        score_result.get('final_score', 0),
            'ai_feedback':          ai_fb,
        })

    try:
        db.collection(COLLECTION).document(submission_id).update(update)
        return True
    except Exception as exc:
        logger.error(f'Firestore update_submission_score error: {exc}')
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Read
# ─────────────────────────────────────────────────────────────────────────────

def get_my_submissions(user, limit=100) -> list:
    """Return all submissions for a user, newest first."""
    db = get_firestore()
    if db is None:
        return []

    try:
        docs = (
            db.collection(COLLECTION)
            .where('user_id', '==', str(user.id))
            .order_by('submitted_at', direction='DESCENDING')
            .limit(limit)
            .stream()
        )
        return [_fmt(d.to_dict()) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_my_submissions error: {exc}')
        return []


def get_challenge_submissions(challenge_id: str, status_filter='scored',
                               limit=100) -> list:
    """Return submissions for a challenge, ordered by score descending."""
    db = get_firestore()
    if db is None:
        return []

    try:
        q = (
            db.collection(COLLECTION)
            .where('challenge_id', '==', str(challenge_id))
        )
        if status_filter:
            q = q.where('status', '==', status_filter)
        docs = q.order_by('final_score', direction='DESCENDING').limit(limit).stream()
        return [_fmt(d.to_dict()) for d in docs]
    except Exception as exc:
        logger.error(f'Firestore get_challenge_submissions error: {exc}')
        return []


def user_has_submitted(user_id: str, challenge_id: str) -> bool:
    """Check if a user has already submitted to a challenge."""
    db = get_firestore()
    if db is None:
        return False

    try:
        docs = (
            db.collection(COLLECTION)
            .where('user_id',      '==', str(user_id))
            .where('challenge_id', '==', str(challenge_id))
            .limit(1)
            .stream()
        )
        return any(True for _ in docs)
    except Exception as exc:
        logger.error(f'Firestore user_has_submitted error: {exc}')
        return False


def get_leaderboard(challenge_id: str, submission_type: str = None,
                    limit: int = 20) -> list:
    """
    Return top scored submissions for a challenge, ranked by final_score.
    submission_type: 'text' | 'image' | None (both)
    """
    db = get_firestore()
    if db is None:
        return []

    try:
        q = (
            db.collection(COLLECTION)
            .where('challenge_id', '==', str(challenge_id))
            .where('status',       '==', 'scored')
        )
        if submission_type:
            q = q.where('submission_type', '==', submission_type)
        docs = q.order_by('final_score', direction='DESCENDING').limit(limit).stream()

        results = []
        for rank, doc in enumerate(docs, start=1):
            d = doc.to_dict()
            results.append({
                'rank':                 rank,
                'user_id':             d.get('user_id', ''),
                'username':            d.get('username', ''),
                'final_score':         d.get('final_score', 0),
                'observation_score':   d.get('observation_score', 0),
                'interpretation_score': d.get('interpretation_score', 0),
                'submitted_at':        _ts(d.get('submitted_at')),
            })
        return results
    except Exception as exc:
        logger.error(f'Firestore get_leaderboard error: {exc}')
        return []


# ─────────────────────────────────────────────────────────────────────────────
#  Migration helpers
# ─────────────────────────────────────────────────────────────────────────────

def migrate_text_submissions(queryset):
    """
    Migrate ChallengeSubmission rows from PostgreSQL.

    Usage:
        from challenges.models import ChallengeSubmission
        from challenges.firestore_submission_service import migrate_text_submissions
        migrate_text_submissions(
            ChallengeSubmission.objects.select_related('challenge', 'user')
        )
    """
    return _bulk_migrate(queryset, _pg_text_to_doc)


def migrate_image_submissions(queryset):
    """
    Migrate ImageInterpretationSubmission rows from PostgreSQL.

    Usage:
        from challenges.models import ImageInterpretationSubmission
        from challenges.firestore_submission_service import migrate_image_submissions
        migrate_image_submissions(
            ImageInterpretationSubmission.objects.select_related('challenge', 'user')
        )
    """
    return _bulk_migrate(queryset, _pg_image_to_doc)


def _bulk_migrate(queryset, row_to_doc_fn):
    db = get_firestore()
    if db is None:
        logger.error('_bulk_migrate: Firestore not available.')
        return 0

    BATCH_SIZE = 400
    migrated   = 0
    batch      = db.batch()
    count      = 0

    for row in queryset.iterator():
        doc = row_to_doc_fn(row)
        ref = db.collection(COLLECTION).document(doc['id'])
        batch.set(ref, doc)
        count    += 1
        migrated += 1

        if count >= BATCH_SIZE:
            batch.commit()
            batch = db.batch()
            count = 0
            logger.info(f'migrate submissions: {migrated} written…')

    if count > 0:
        batch.commit()

    logger.info(f'migrate submissions: done — {migrated} total.')
    return migrated


def _pg_text_to_doc(s) -> dict:
    return {
        'id':                      str(s.id),
        'challenge_id':            str(s.challenge_id),
        'challenge_title':         s.challenge.title,
        'user_id':                 str(s.user_id),
        'username':                s.user.username,
        'submission_type':         'text',
        'interpretation':          s.interpretation,
        'word_count':              s.word_count,
        'discovered_points':       [],
        'overall_message':         '',
        'submission_time_seconds': s.submission_time_seconds,
        'status':                  s.status,
        'creativity_score':        s.creativity_score,
        'relevance_score':         s.relevance_score,
        'detail_score':            s.detail_score,
        'observation_score':       0,
        'interpretation_score':    0,
        'final_score':             s.final_score,
        'points_earned':           s.final_score,
        'prize_awarded':           0.0,
        'ai_feedback':             '',
        'submitted_at':            s.submitted_at,
        'scored_at':               s.scored_at,
        '_pg_id':                  str(s.id),
    }


def _pg_image_to_doc(s) -> dict:
    return {
        'id':                      str(s.id),
        'challenge_id':            str(s.challenge_id),
        'challenge_title':         s.challenge.title,
        'user_id':                 str(s.user_id),
        'username':                s.user.username,
        'submission_type':         'image',
        'interpretation':          '',
        'word_count':              0,
        'discovered_points':       s.discovered_points or [],
        'overall_message':         s.overall_message or '',
        'submission_time_seconds': s.submission_time_seconds,
        'status':                  s.status,
        'creativity_score':        0,
        'relevance_score':         0,
        'detail_score':            0,
        'observation_score':       s.observation_score,
        'interpretation_score':    s.interpretation_score,
        'final_score':             s.final_score,
        'points_earned':           s.points_earned,
        'prize_awarded':           float(s.prize_awarded),
        'ai_feedback':             s.ai_feedback or '',
        'submitted_at':            s.submitted_at,
        'scored_at':               s.scored_at,
        '_pg_id':                  str(s.id),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(val) -> str | None:
    if val is None:
        return None
    if hasattr(val, 'isoformat'):
        return val.isoformat()
    if hasattr(val, 'timestamp'):
        from datetime import datetime as _dt
        return _dt.fromtimestamp(val.timestamp(), tz=timezone.utc).isoformat()
    return str(val)


def _fmt(d: dict) -> dict:
    """Normalise a Firestore submission document to the REST API shape."""
    import json as _json

    # Parse ai_feedback — might be a JSON string with summary + point_results
    fb_raw  = d.get('ai_feedback', '')
    summary = fb_raw
    point_results = []
    try:
        if fb_raw.startswith('{'):
            parsed        = _json.loads(fb_raw)
            summary       = parsed.get('summary', fb_raw)
            point_results = parsed.get('point_results', [])
    except Exception:
        pass

    return {
        'id':                      d.get('id', ''),
        'challenge':               d.get('challenge_id', ''),
        'challenge_title':         d.get('challenge_title', ''),
        'user': {
            'username':      d.get('username', ''),
            'display_name':  d.get('username', ''),
            'profile_image': None,
        },
        'submission_type':         d.get('submission_type', 'text'),
        'interpretation':          d.get('interpretation', ''),
        'word_count':              d.get('word_count', 0),
        'discovered_points':       d.get('discovered_points', []),
        'overall_message':         d.get('overall_message', ''),
        'submission_time_seconds': d.get('submission_time_seconds', 0),
        'status':                  d.get('status', 'submitted'),
        'creativity_score':        d.get('creativity_score', 0),
        'relevance_score':         d.get('relevance_score', 0),
        'detail_score':            d.get('detail_score', 0),
        'observation_score':       d.get('observation_score', 0),
        'interpretation_score':    d.get('interpretation_score', 0),
        'final_score':             d.get('final_score', 0),
        'points_earned':           d.get('points_earned', 0),
        'prize_awarded':           d.get('prize_awarded', 0.0),
        'ai_feedback':             summary,
        'point_results':           point_results,
        'submitted_at':            _ts(d.get('submitted_at')),
        'scored_at':               _ts(d.get('scored_at')),
    }
