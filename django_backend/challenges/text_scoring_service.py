"""
Text Interpretation Scoring Service
=====================================
Uses Groq (LLaMA 3.3) to evaluate a participant's written interpretation
against the challenge description, difficulty, and scoring weights set by
the creator.

Scoring model
─────────────
  Creativity   — originality, unique perspective, unexpected connections
  Relevance    — how well the interpretation relates to the image/prompt
  Detail       — depth, specificity, supporting evidence in the writing

Each dimension is scored 0–100 then weighted using the challenge's own
creativity_weight / relevance_weight / detail_weight percentages.
The final weighted average is mapped to the challenge's min_points–max_points
range and stored as the submission's final_score.

Returns a dict:
  {
    "creativity_score":    int (0–100),
    "relevance_score":     int (0–100),
    "detail_score":        int (0–100),
    "final_score":         int (min_points – max_points),
    "ai_feedback":         str,
  }
"""
import json
import logging
import requests as http
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


# ─────────────────────────────────────────────────────────────────────────────
#  Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _call_groq(prompt: str) -> str | None:
    """Send a single-turn prompt to Groq and return the raw text response."""
    api_key = getattr(settings, "GROQ_API_KEY", "").strip()
    if not api_key:
        logger.warning("GROQ_API_KEY not set — falling back to rule-based text scoring.")
        return None

    try:
        response = http.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":    GROQ_MODEL,
                "messages": [
                    {
                        "role":    "system",
                        "content": (
                            "You are an expert creative-writing evaluator for an art interpretation platform. "
                            "Score participant submissions fairly and constructively. "
                            "Return ONLY valid JSON — no markdown fences, no extra text."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens":  800,
            },
            timeout=40,
        )

        if response.status_code != 200:
            logger.error(f"Groq API {response.status_code}: {response.text[:300]}")
            return None

        return response.json()["choices"][0]["message"]["content"].strip()

    except Exception as exc:
        logger.error(f"Groq text-scoring error: {exc}")
        return None


def _map_to_points(weighted_score: float, min_pts: int, max_pts: int) -> int:
    """Map a 0–100 weighted score to the challenge's min–max points range."""
    pts_range = max_pts - min_pts
    return int(min_pts + (weighted_score / 100.0) * pts_range)


# ─────────────────────────────────────────────────────────────────────────────
#  Public API
# ─────────────────────────────────────────────────────────────────────────────

def score_text_interpretation(
    challenge_title:       str,
    challenge_description: str,
    difficulty:            str,
    submission_rules:      list,
    creativity_weight:     int,
    relevance_weight:      int,
    detail_weight:         int,
    min_points:            int,
    max_points:            int,
    interpretation:        str,
    word_count:            int,
) -> dict:
    """
    Score a text interpretation submission.

    Parameters
    ----------
    challenge_title       : Challenge title shown to the participant.
    challenge_description : Full challenge description / prompt.
    difficulty            : easy / medium / hard / expert.
    submission_rules      : List of rule strings set by the creator.
    creativity_weight     : Creator-defined % weight for creativity (0–100).
    relevance_weight      : Creator-defined % weight for relevance (0–100).
    detail_weight         : Creator-defined % weight for detail (0–100).
    min_points / max_points : Points range for this challenge.
    interpretation        : The participant's full submission text.
    word_count            : Pre-counted word count of the submission.

    Returns
    -------
    dict with keys: creativity_score, relevance_score, detail_score,
                    final_score, ai_feedback
    """
    rules_block = "\n".join(f"  - {r}" for r in (submission_rules or [])) or "  (none specified)"

    prompt = f"""
You are scoring a participant's written interpretation for an art challenge.

## Challenge details
- Title:       {challenge_title}
- Description: {challenge_description}
- Difficulty:  {difficulty}
- Submission rules:
{rules_block}

## Scoring weights (set by the challenge creator)
- Creativity : {creativity_weight}%
- Relevance  : {relevance_weight}%
- Detail     : {detail_weight}%

## Participant's submission ({word_count} words)
\"\"\"{interpretation}\"\"\"

## Your task
Score the submission on three dimensions (each 0–100):

1. creativity_score — Originality, unique perspective, imaginative connections.
   Does the interpretation bring a fresh angle or unexpected insight?

2. relevance_score — How well does the interpretation relate to the challenge
   description and follow the submission rules?

3. detail_score — Depth, specificity, use of concrete examples or evidence
   within the writing itself.

Calibrate scores to the "{difficulty}" difficulty level:
  easy   → scoring is generous, minor errors are forgiven
  medium → balanced, clear effort expected
  hard   → high bar, thorough analysis expected
  expert → near-flawless insight and depth required

Write a short ai_feedback string (2–4 sentences) that is encouraging and specific:
mention one thing done well and one area to improve.

## Return format — JSON ONLY, no markdown
{{
  "creativity_score": <int 0-100>,
  "relevance_score":  <int 0-100>,
  "detail_score":     <int 0-100>,
  "ai_feedback":      "<string>"
}}
"""

    raw = _call_groq(prompt)

    if raw:
        try:
            result = json.loads(raw)
            creativity = max(0, min(100, int(result["creativity_score"])))
            relevance  = max(0, min(100, int(result["relevance_score"])))
            detail     = max(0, min(100, int(result["detail_score"])))
            feedback   = str(result.get("ai_feedback", ""))

            weighted = (
                creativity * creativity_weight / 100
                + relevance  * relevance_weight  / 100
                + detail     * detail_weight     / 100
            )
            final = _map_to_points(weighted, min_points, max_points)

            return {
                "creativity_score": creativity,
                "relevance_score":  relevance,
                "detail_score":     detail,
                "final_score":      final,
                "ai_feedback":      feedback,
            }

        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            logger.error(f"Failed to parse Groq text-scoring response: {exc}\nRaw: {raw[:500]}")

    # ── Rule-based fallback ──────────────────────────────────────────────────
    return _rule_based_score(
        difficulty=difficulty,
        creativity_weight=creativity_weight,
        relevance_weight=relevance_weight,
        detail_weight=detail_weight,
        min_points=min_points,
        max_points=max_points,
        interpretation=interpretation,
        word_count=word_count,
        challenge_description=challenge_description,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  Rule-based fallback
# ─────────────────────────────────────────────────────────────────────────────

def _rule_based_score(
    difficulty:        str,
    creativity_weight: int,
    relevance_weight:  int,
    detail_weight:     int,
    min_points:        int,
    max_points:        int,
    interpretation:    str,
    word_count:        int,
    challenge_description: str,
) -> dict:
    """
    Keyword + heuristic fallback scorer used when Groq is unavailable.
    Scores are intentionally generous to avoid penalising users for API outages.
    """
    text_lower = interpretation.lower()
    desc_lower = challenge_description.lower()

    # ── Creativity: sentence variety & connective language ──────────────────
    sentences = [s.strip() for s in interpretation.split('.') if s.strip()]
    avg_sent_len = (word_count / max(len(sentences), 1))
    # Variety bonus: longer, complex sentences suggest more depth
    creativity = min(100, 45 + int(avg_sent_len * 1.5) + (5 if word_count > 100 else 0))

    # Metaphor / figurative language cues
    creative_cues = ['represent', 'symbol', 'metaphor', 'evoke', 'suggest', 'imagine',
                     'feel', 'emotion', 'convey', 'embody', 'reflect', 'capture']
    creativity += sum(5 for cue in creative_cues if cue in text_lower)
    creativity = min(100, creativity)

    # ── Relevance: keyword overlap with challenge description ────────────────
    desc_keywords = [w for w in desc_lower.split() if len(w) > 4]
    overlap = sum(1 for kw in desc_keywords if kw in text_lower)
    relevance = min(100, 40 + int((overlap / max(len(desc_keywords), 1)) * 60))

    # ── Detail: word count tiers ─────────────────────────────────────────────
    if word_count >= 200:
        detail = 85
    elif word_count >= 150:
        detail = 75
    elif word_count >= 100:
        detail = 65
    elif word_count >= 70:
        detail = 55
    else:
        detail = 45

    # Specific detail cues
    detail_cues = ['because', 'therefore', 'specifically', 'for example', 'such as',
                   'in particular', 'notably', 'this shows', 'evident']
    detail += sum(4 for cue in detail_cues if cue in text_lower)
    detail = min(100, detail)

    # ── Difficulty penalty ────────────────────────────────────────────────────
    # Harder challenges expect more; apply a mild cap on fallback scores
    difficulty_cap = {'easy': 100, 'medium': 90, 'hard': 80, 'expert': 70}
    cap = difficulty_cap.get(difficulty, 90)
    creativity = min(cap, creativity)
    relevance  = min(cap, relevance)
    detail     = min(cap, detail)

    weighted = (
        creativity * creativity_weight / 100
        + relevance  * relevance_weight  / 100
        + detail     * detail_weight     / 100
    )
    final = _map_to_points(weighted, min_points, max_points)

    # ── Generic feedback ──────────────────────────────────────────────────────
    if weighted >= 75:
        feedback = (
            "Strong submission! Your interpretation shows good creativity and engages "
            "well with the challenge. To improve further, try adding more specific "
            "examples to support your ideas."
        )
    elif weighted >= 55:
        feedback = (
            "Good effort — your interpretation is on the right track. "
            "Adding more depth and connecting your ideas more explicitly to the "
            "challenge prompt will push your score higher."
        )
    else:
        feedback = (
            "You've made a start, but the interpretation needs more development. "
            "Try to expand on your ideas, use more specific language, and make sure "
            "your response clearly addresses the challenge description."
        )

    return {
        "creativity_score": creativity,
        "relevance_score":  relevance,
        "detail_score":     detail,
        "final_score":      final,
        "ai_feedback":      feedback,
    }
