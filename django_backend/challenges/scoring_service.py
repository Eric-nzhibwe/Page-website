"""
Image Interpretation Scoring Service
=====================================
Uses Groq (LLaMA 3.3) to evaluate participant submissions against the
creator-defined answer key.

Scoring model
─────────────
  Observation accuracy   60% — were the hidden visual points discovered?
  Interpretation quality 40% — do the explanations align with accepted meanings?

Returns a dict:
  {
    "observation_score":    int (0–100),
    "interpretation_score": int (0–100),
    "matched_count":        int,
    "total_points":         int,
    "ai_feedback":          str,
    "point_results":        [{"label": "...", "matched": bool, "score": int, "feedback": "..."}]
  }
"""
import json
import logging
import requests as http
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


def _call_groq(prompt: str) -> str | None:
    """Send a single-turn prompt to Groq and return the raw text response."""
    api_key = getattr(settings, "GROQ_API_KEY", "").strip()
    if not api_key:
        logger.warning("GROQ_API_KEY not set — cannot use AI scoring.")
        return None

    try:
        response = http.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":       GROQ_MODEL,
                "messages":    [
                    {"role": "system", "content": "You are an expert visual-art scoring assistant. Return ONLY valid JSON — no markdown fences, no extra text."},
                    {"role": "user",   "content": prompt},
                ],
                "temperature": 0.2,
                "max_tokens":  1200,
            },
            timeout=40,
        )

        if response.status_code != 200:
            logger.error(f"Groq API {response.status_code}: {response.text[:300]}")
            return None

        return response.json()["choices"][0]["message"]["content"].strip()

    except Exception as exc:
        logger.error(f"Groq scoring error: {exc}")
        return None


def score_image_interpretation(
    hidden_points: list,       # challenge.hidden_points
    discovered_points: list,   # submission.discovered_points
    overall_message: str,      # submission.overall_message
) -> dict:
    """
    Score an Image Interpretation submission.

    Parameters
    ----------
    hidden_points : list of dicts
        [{"label": "Broken clock", "accepted_meanings": ["lost time", "urgency"]}]
    discovered_points : list of dicts
        [{"label": "Broken clock", "interpretation": "Represents wasted time"}]
    overall_message : str
        Participant's overall interpretation of the image.

    Returns
    -------
    dict with keys: observation_score, interpretation_score, matched_count,
                    total_points, ai_feedback, point_results
    """
    total_points = len(hidden_points)

    # ── Build AI prompt ──────────────────────────────────────────────────────
    prompt = f"""
You are scoring an Image Interpretation challenge submission.

## Creator's hidden points (answer key)
{json.dumps(hidden_points, indent=2)}

## Participant's discovered points
{json.dumps(discovered_points, indent=2)}

## Participant's overall message for the image
"{overall_message}"

## Your task
1. For each creator hidden point, check if the participant discovered it (even with different wording).
2. If discovered, score the interpretation quality 0–100 based on how well it aligns with the accepted meanings.
3. Compute:
   - observation_score  (0–100): (matched / total) × 100, rounded
   - interpretation_score (0–100): average of per-point interpretation scores for matched points (or 0 if none matched)
4. Write a short, encouraging ai_feedback string (2–4 sentences) summarising what they did well and what they missed.

## Return format — JSON ONLY, no markdown
{{
  "observation_score": <int 0-100>,
  "interpretation_score": <int 0-100>,
  "matched_count": <int>,
  "total_points": {total_points},
  "ai_feedback": "<string>",
  "point_results": [
    {{
      "label": "<hidden point label>",
      "matched": <true|false>,
      "score": <int 0-100>,
      "feedback": "<one sentence>"
    }}
  ]
}}
"""

    raw = _call_groq(prompt)

    if raw:
        try:
            result = json.loads(raw)
            # Sanitise and clamp
            result["observation_score"]    = max(0, min(100, int(result.get("observation_score", 0))))
            result["interpretation_score"] = max(0, min(100, int(result.get("interpretation_score", 0))))
            result["matched_count"]        = int(result.get("matched_count", 0))
            result["total_points"]         = total_points
            result["ai_feedback"]          = str(result.get("ai_feedback", ""))
            result.setdefault("point_results", [])
            return result
        except (json.JSONDecodeError, KeyError, ValueError) as exc:
            logger.error(f"Failed to parse Groq scoring response: {exc}\nRaw: {raw[:500]}")

    # ── Rule-based fallback ──────────────────────────────────────────────────
    return _rule_based_score(hidden_points, discovered_points, overall_message)


def _rule_based_score(
    hidden_points: list,
    discovered_points: list,
    overall_message: str,
) -> dict:
    """
    Simple keyword-matching fallback used when Groq is unavailable.
    Compares lowercase labels and accepted meanings against participant labels/interpretations.
    """
    total = len(hidden_points)
    if total == 0:
        return {
            "observation_score":    80,
            "interpretation_score": 70,
            "matched_count":        0,
            "total_points":         0,
            "ai_feedback":          "No hidden points were set for this challenge — your submission was accepted.",
            "point_results":        [],
        }

    point_results = []
    matched_count = 0
    interp_scores = []

    for hp in hidden_points:
        hp_label    = hp.get("label", "").lower()
        hp_meanings = [m.lower() for m in hp.get("accepted_meanings", [])]

        matched      = False
        point_score  = 0
        point_fb     = "Not identified."

        for dp in discovered_points:
            dp_label  = dp.get("label", "").lower()
            dp_interp = dp.get("interpretation", "").lower()

            # Check label similarity (substring match is a good heuristic)
            label_match = (
                hp_label in dp_label
                or dp_label in hp_label
                or any(word in dp_label for word in hp_label.split() if len(word) > 3)
            )

            # Check interpretation alignment
            meaning_match_score = 0
            for meaning in hp_meanings:
                for word in meaning.split():
                    if len(word) > 3 and word in dp_interp:
                        meaning_match_score += 20
            meaning_match_score = min(100, meaning_match_score)

            if label_match:
                matched    = True
                point_score = min(100, 50 + meaning_match_score // 2)
                point_fb    = "Identified with reasonable interpretation."
                break

        if matched:
            matched_count += 1
            interp_scores.append(point_score)

        point_results.append({
            "label":    hp.get("label", ""),
            "matched":  matched,
            "score":    point_score,
            "feedback": point_fb,
        })

    observation_score = int((matched_count / total) * 100) if total else 0
    interpretation_score = int(sum(interp_scores) / len(interp_scores)) if interp_scores else 0

    # Bonus for non-empty overall message
    if overall_message and len(overall_message.split()) >= 10:
        interpretation_score = min(100, interpretation_score + 10)

    matched_labels = [r["label"] for r in point_results if r["matched"]]
    missed_labels  = [r["label"] for r in point_results if not r["matched"]]

    if matched_count == total:
        feedback = f"Excellent observation! You identified all {total} hidden points. Great interpretations throughout."
    elif matched_count > total // 2:
        missed_str = ", ".join(missed_labels[:3]) or "a few"
        feedback = (
            f"Good work — you found {matched_count} of {total} hidden points. "
            f"You missed: {missed_str}. Keep practising your observation skills!"
        )
    else:
        found_str = ", ".join(matched_labels[:3]) or "some"
        feedback = (
            f"You identified {matched_count} of {total} hidden points (found: {found_str}). "
            "Look more carefully at the details — colours, objects in the background, and symbolic elements."
        )

    return {
        "observation_score":    observation_score,
        "interpretation_score": interpretation_score,
        "matched_count":        matched_count,
        "total_points":         total,
        "ai_feedback":          feedback,
        "point_results":        point_results,
    }
