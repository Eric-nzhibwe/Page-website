"""
PAGE AI Service
===============
Primary model  : openai/gpt-oss-120b  (via Groq)
Fallback model : openai/gpt-oss-20b   (via Groq)
Vision model   : meta-llama/llama-4-scout-17b-16e-instruct (via Groq — multimodal)
Voice          : whisper-large-v3 (via Groq)

Both text model IDs are overridable with env vars so a Groq deprecation
is a config change, not a code change.
"""
import logging
import requests as http
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ_API_URL     = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

PRIMARY_MODEL  = getattr(settings, 'GROQ_MODEL',          'openai/gpt-oss-120b')
FALLBACK_MODEL = getattr(settings, 'GROQ_MODEL_FALLBACK',  'openai/gpt-oss-20b')
VISION_MODEL   = getattr(settings, 'GROQ_VISION_MODEL',    'meta-llama/llama-4-scout-17b-16e-instruct')

# ── System prompt ──────────────────────────────────────────────────────────────
_SYSTEM = """You are PAGE AI — the assistant built into PAGE, a competitive gaming platform based in Zambia.

Talk like a real person. Specifically:
- Get to the point. If the question needs two sentences, give two sentences.
- Use casual, natural language. Contractions ("you're", "it's") are fine.
- Never start a reply with "Great question!", "Sure!", "Of course!", or anything like that. Just answer.
- Bullet points are fine when listing steps or options. Skip them when you're just chatting.
- One or two emojis is fine if they genuinely fit — don't force them.
- If you don't know something, say so plainly. Don't invent facts.
- Never say "As an AI..." — you're PAGE AI. Just talk.

About PAGE:
- Competitive gaming and challenges platform in Zambia.
- Currency: Zambian Kwacha (ZMW) shown as "K".
- Payments: PawaPay mobile money (MTN Zambia, Airtel Money), Stripe card, Paystack.
- Prestige tier system (earned from challenges, tournaments, daily streaks):
    Bronze (0–199) → Silver (200–499) → Gold (500–999) → Platinum (1,000–1,499)
    → Diamond (1,500–2,499) → Elite (2,500–4,999) → Legendary (5,000+)
- Alliances: teams that run group challenges and split rewards.
- Wallet: users deposit and withdraw. Withdrawals process within 24 hours.
- Messenger: real-time chat and media sharing between users.
- Daily streaks: log in + complete a challenge every day to multiply prestige earnings.

You're not limited to PAGE topics. If someone asks something general — coding, life, current events, whatever — help them like a knowledgeable friend would.
"""


def _build_system(user_ctx: dict | None) -> str:
    prompt = _SYSTEM
    if not user_ctx:
        return prompt
    lines = []
    if user_ctx.get('username'):
        lines.append(f"- Username: {user_ctx['username']}")
    if user_ctx.get('prestige_points') is not None:
        lines.append(f"- Prestige points: {user_ctx['prestige_points']}")
    if user_ctx.get('tier'):
        lines.append(f"- Current tier: {user_ctx['tier']}")
    if user_ctx.get('wallet_balance') is not None:
        lines.append(f"- Wallet balance: K{float(user_ctx['wallet_balance']):.2f}")
    if lines:
        prompt += '\n\n## This user\'s live data\n' + '\n'.join(lines)
    return prompt


# ── Groq text completion ───────────────────────────────────────────────────────

def groq_chat(message: str, history: list, user_ctx: dict | None) -> str | None:
    """
    Call Groq with the primary model, auto-retry with fallback on 400/404.
    Returns the response string, or None if Groq is unreachable / misconfigured.
    history: list of {"role": "user"|"assistant", "content": "..."} dicts.
    """
    api_key = getattr(settings, 'GROQ_API_KEY', '').strip()
    if not api_key:
        logger.warning('GROQ_API_KEY not set — using rule-based fallback')
        return None

    messages = [{'role': 'system', 'content': _build_system(user_ctx)}]
    for turn in history[-20:]:
        role    = turn.get('role', 'user')
        content = turn.get('content', '').strip()
        if role in ('user', 'assistant') and content:
            messages.append({'role': role, 'content': content})
    messages.append({'role': 'user', 'content': message})

    def _call(model_id: str):
        return http.post(
            GROQ_API_URL,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={'model': model_id, 'messages': messages,
                  'temperature': 0.75, 'max_tokens': 800, 'top_p': 0.95},
            timeout=30,
        )

    try:
        resp = _call(PRIMARY_MODEL)
        if resp.status_code in (400, 404):
            logger.warning(f'Primary model {PRIMARY_MODEL!r} → {resp.status_code}, retrying with fallback')
            resp = _call(FALLBACK_MODEL)

        if resp.status_code != 200:
            logger.error(f'Groq API {resp.status_code}: {resp.text[:400]}')
            return None

        data    = resp.json()
        choices = data.get('choices')
        if not choices or not choices[0].get('message'):
            logger.error(f'Unexpected Groq response shape: {str(data)[:300]}')
            return None
        return data['choices'][0]['message']['content'].strip()

    except Exception as exc:
        logger.error(f'Groq request error: {exc}')
        return None


# ── Groq vision completion ─────────────────────────────────────────────────────

def groq_vision(message: str, image_b64: str, image_mime: str,
                user_ctx: dict | None, api_key: str) -> tuple[str, str]:
    """
    Send an image + text to the Groq vision model.
    Returns (response_text, source_label).
    """
    try:
        resp = http.post(
            GROQ_API_URL,
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={
                'model': VISION_MODEL,
                'messages': [
                    {'role': 'system', 'content': _build_system(user_ctx)},
                    {
                        'role': 'user',
                        'content': [
                            {'type': 'image_url',
                             'image_url': {'url': f'data:{image_mime};base64,{image_b64}', 'detail': 'auto'}},
                            {'type': 'text', 'text': message or 'What do you see in this image?'},
                        ],
                    },
                ],
                'temperature': 0.65,
                'max_tokens': 1024,
            },
            timeout=60,
        )
        logger.info(f'Vision model {VISION_MODEL!r} → {resp.status_code}')
        if resp.status_code == 200:
            return resp.json()['choices'][0]['message']['content'].strip(), 'groq-vision'

        err = resp.json().get('error', {}).get('message', resp.text[:300])
        logger.error(f'Vision failed ({resp.status_code}): {err}')
        return ("Couldn't analyse that image right now. Try describing what's in it and I'll help from there 🖼️",
                'fallback')
    except Exception as exc:
        logger.error(f'Vision exception: {exc}')
        return "Had trouble reading the image. Please try again.", 'fallback'


# ── Groq Whisper transcription ─────────────────────────────────────────────────

def groq_transcribe(audio_path: str, ext: str, mime: str, api_key: str) -> str | None:
    """Transcribe an audio file. Returns transcript string or None on failure."""
    try:
        with open(audio_path, 'rb') as f:
            resp = http.post(
                GROQ_WHISPER_URL,
                headers={'Authorization': f'Bearer {api_key}'},
                files={'file': (f'recording{ext}', f, mime)},
                data={'model': 'whisper-large-v3', 'response_format': 'verbose_json', 'language': 'en'},
                timeout=60,
            )
        if resp.status_code != 200:
            logger.error(f'Whisper {resp.status_code}: {resp.text[:300]}')
            return None
        return resp.json().get('text', '').strip() or None
    except Exception as exc:
        logger.error(f'Whisper exception: {exc}')
        return None


# ── Rule-based fallback ────────────────────────────────────────────────────────

def rule_based(message: str, user_ctx: dict | None) -> str:
    """Plain keyword responses used when Groq is unavailable."""
    m   = message.lower()
    ctx = user_ctx or {}

    if any(w in m for w in ['hi', 'hello', 'hey', 'howdy', 'sup', 'good morning', 'good evening']):
        name = ctx.get('username', '')
        return (f"Hey {name}! 👋 What can I help you with?" if name else "Hey! 👋 What can I help you with?")

    if any(w in m for w in ['how are you', 'how r u', 'you okay']):
        return "All good! What's up?"

    if any(w in m for w in ['balance', 'how much', 'my wallet', 'my money']):
        bal = ctx.get('wallet_balance')
        if bal is not None:
            return f"You've got **K{float(bal):.2f}** in your wallet. Want to top it up or cash out?"
        return "Head to the **Wallet** page to check your balance."

    if any(w in m for w in ['deposit', 'add money', 'top up', 'fund']):
        return ("To deposit:\n1. Open **Wallet**\n2. Tap **Deposit**\n"
                "3. Pick Mobile Money (MTN/Airtel) or Card\n4. Enter amount and confirm\n\nGoes in instantly 💰")

    if any(w in m for w in ['withdraw', 'cash out', 'payout', 'send money']):
        return ("To withdraw:\n1. Open **Wallet**\n2. Tap **Withdraw**\n"
                "3. Choose Mobile Money, Bank, or PayPal\n4. Enter amount and details\n\nProcessed within 24 hours.")

    if any(w in m for w in ['prestige', 'tier', 'level', 'rank', 'points', 'bronze', 'gold', 'diamond', 'legendary']):
        pts  = ctx.get('prestige_points')
        tier = ctx.get('tier')
        intro = f"You're at **{pts} prestige points** — **{tier} tier**.\n\n" if pts is not None else ''
        return (intro + "Tier ladder:\n"
                "🥉 Bronze → 🥈 Silver → 🥇 Gold → 💎 Platinum → 💠 Diamond → ⭐ Elite → 🏆 Legendary\n\n"
                "Complete challenges, win tournaments, and keep your daily streak going to climb.")

    if any(w in m for w in ['challenge', 'play', 'compete', 'game', 'quiz']):
        return "Challenges are how you earn prestige and cash on PAGE. Check the **Challenges** tab to find one."

    if any(w in m for w in ['tournament', 'competition', 'event', 'contest']):
        return "Tournaments are timed events with prize pools — top scorers split the winnings. Check **Challenges** for what's live."

    if any(w in m for w in ['alliance', 'team', 'clan', 'group', 'squad']):
        return "Alliances let you team up for group challenges and shared rewards. Go to **Community** to find or create one."

    if any(w in m for w in ['streak', 'daily', 'consecutive']):
        return "Log in and complete at least one challenge every day to keep your streak. Longer streak = more prestige per challenge 🔥"

    if any(w in m for w in ['payment', 'mtn', 'airtel', 'mpesa', 'stripe', 'paystack', 'mobile money']):
        return ("PAGE supports:\n📱 **Mobile Money** via PawaPay — MTN, Airtel, M-Pesa\n"
                "💳 **Card** via Stripe\n🏦 **Paystack** — card and bank\n\nAll amounts in Zambian Kwacha (ZMW).")

    if any(w in m for w in ['thank', 'thanks', 'cheers', 'appreciate']):
        return "No problem! Anything else?"

    if any(w in m for w in ['help', 'what can you do', 'support']):
        return ("I can help with:\n💰 Wallet, deposits & withdrawals\n🎮 Challenges, tournaments & games\n"
                "⭐ Prestige points, tiers & streaks\n🤝 Alliances & community\n\nAnd general questions too — just ask.")

    return ("I'm in basic mode and can't answer that one right now.\n\n"
            "Add **GROQ_API_KEY** to your `.env` to unlock full AI (free at console.groq.com/keys).")


# ── Main callable ──────────────────────────────────────────────────────────────

def get_ai_response(message: str, history: list, user_ctx: dict | None) -> tuple[str, str]:
    """
    Returns (response_text, source_label).
    source_label: 'groq' | 'fallback'
    """
    result = groq_chat(message, history, user_ctx)
    if result:
        return result, 'groq'
    logger.info('Groq unavailable — using rule-based fallback')
    return rule_based(message, user_ctx), 'fallback'
