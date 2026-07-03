"""
ARTX AI Service — powered by Groq (LLaMA 3.3)
================================================
Primary:  Groq REST API — called directly with `requests` (no extra SDK needed)
Fallback: Smart rule-based responses

Setup:
  1. Get a FREE key at https://console.groq.com/keys
  2. Add GROQ_API_KEY=gsk_... to your .env file
  3. Restart the server — done, no pip install needed.
"""
import logging
import requests as http
from django.conf import settings

logger = logging.getLogger(__name__)

GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# ── System prompt ─────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are ARTX AI, the smart assistant built into the ARTX competitive gaming platform.

## Your personality
- Friendly, conversational, and helpful — like talking to a knowledgeable friend
- Give direct, useful answers without being robotic or repeating canned phrases
- Use bullet points or numbered steps when that makes things clearer
- Use 1–2 emojis per reply to stay lively, not overwhelming
- Be honest when you don't know something

## About ARTX
- Competitive gaming and challenges platform based in Zambia
- Currency: Zambian Kwacha (ZMW, shown as "K")
- Payment methods: PawaPay mobile money (MTN Zambia, Airtel Money), Stripe card, Paystack
- Prestige tier system (earned by completing challenges, winning tournaments, daily streaks):
    Bronze (0–199) → Silver (200–499) → Gold (500–999) → Platinum (1,000–1,499)
    → Diamond (1,500–2,499) → Elite (2,500–4,999) → Legendary (5,000+)
- Alliances: teams where players collaborate on group challenges and share rewards
- Wallet: users deposit and withdraw funds; withdrawals process within 24 hours
- Messenger: real-time chat and media sharing between users
- Daily streaks: log in and complete a challenge each day to multiply prestige earnings

## How to respond
- Answer the user's actual question first, then offer related info if useful
- Use the user's personal context (balance, tier, username) naturally when available
- For questions outside the platform (general knowledge, coding, current events, etc.) — answer helpfully; you are a full-featured AI assistant, not just a FAQ bot
- Keep responses under ~200 words unless the question genuinely needs more depth
- Never say "As an AI language model..." — just answer naturally
"""


def _build_system(user_context: dict | None) -> str:
    """Append live user data to the system prompt when available."""
    prompt = SYSTEM_PROMPT
    if not user_context:
        return prompt

    lines = []
    if user_context.get("username"):
        lines.append(f"- Username: {user_context['username']}")
    if user_context.get("prestige_points") is not None:
        lines.append(f"- Prestige points: {user_context['prestige_points']}")
    if user_context.get("tier"):
        lines.append(f"- Current tier: {user_context['tier']}")
    if user_context.get("wallet_balance") is not None:
        lines.append(f"- Wallet balance: K{float(user_context['wallet_balance']):.2f}")

    if lines:
        prompt += "\n\n## Current user's live data\n" + "\n".join(lines)

    return prompt


def _groq_response(
    message: str,
    history: list,
    user_context: dict | None,
) -> str | None:
    """
    Call Groq LLaMA 3.3 directly via its REST API using the `requests`
    library that is already in requirements.txt — no extra SDK needed.

    history items: {"role": "user"|"assistant", "content": "..."}
    Returns the response text, or None if Groq is unavailable.
    """
    api_key = getattr(settings, "GROQ_API_KEY", "").strip()
    if not api_key:
        logger.warning("GROQ_API_KEY not set — falling back to rule-based responses.")
        return None

    try:
        # Build messages: system + history + current turn
        messages = [{"role": "system", "content": _build_system(user_context)}]

        for turn in history[-20:]:
            role    = turn.get("role", "user")
            content = turn.get("content", "").strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": message})

        response = http.post(
            GROQ_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type":  "application/json",
            },
            json={
                "model":       GROQ_MODEL,
                "messages":    messages,
                "temperature": 0.75,
                "max_tokens":  700,
                "top_p":       0.95,
            },
            timeout=30,
        )

        if response.status_code != 200:
            logger.error(f"Groq API returned {response.status_code}: {response.text[:300]}")
            return None

        data = response.json()
        return data["choices"][0]["message"]["content"].strip()

    except Exception as e:
        logger.error(f"Groq API error: {e}")
        return None


# ── Smart rule-based fallback ─────────────────────────────────────────────────

def _rule_based_response(message: str, user_context: dict | None) -> str:
    """Covers common queries when Groq is unavailable."""
    m   = message.lower()
    ctx = user_context or {}

    if any(w in m for w in ["hi", "hello", "hey", "howdy", "sup", "good morning", "good evening"]):
        name = ctx.get("username", "there")
        return f"Hey {name}! 👋 I'm ARTX AI. Ask me about your wallet, challenges, tiers — or anything else!"

    if any(w in m for w in ["how are you", "how r u", "you okay"]):
        return "Doing great, thanks! How can I help you today? 😊"

    if any(w in m for w in ["balance", "how much", "my wallet", "my money"]):
        bal = ctx.get("wallet_balance")
        if bal is not None:
            return f"Your current wallet balance is **K{float(bal):.2f}**. Want to top it up or make a withdrawal?"
        return "Head to the **Wallet** page to check your balance. You can deposit via mobile money (MTN/Airtel) or card anytime."

    if any(w in m for w in ["deposit", "add money", "top up", "fund"]):
        return (
            "To deposit funds:\n"
            "1. Open the **Wallet** page\n"
            "2. Tap **Deposit**\n"
            "3. Choose Mobile Money (MTN/Airtel) or Card\n"
            "4. Enter the amount and confirm\n\n"
            "Deposits are credited instantly! 💰"
        )

    if any(w in m for w in ["withdraw", "cash out", "payout", "send money"]):
        return (
            "To withdraw:\n"
            "1. Open the **Wallet** page\n"
            "2. Tap **Withdraw**\n"
            "3. Choose your method — Mobile Money, Bank Transfer, or PayPal\n"
            "4. Enter amount and account details\n\n"
            "Withdrawals are processed within 24 hours."
        )

    if any(w in m for w in ["prestige", "tier", "level", "rank", "points", "bronze", "gold", "diamond", "legendary"]):
        pts  = ctx.get("prestige_points")
        tier = ctx.get("tier")
        intro = f"You're at **{pts} prestige points** — **{tier} tier**.\n\n" if pts is not None else ""
        return (
            intro +
            "Tier ladder:\n"
            "🥉 Bronze → 🥈 Silver → 🥇 Gold → 💎 Platinum → 💠 Diamond → ⭐ Elite → 🏆 Legendary\n\n"
            "Earn points by completing challenges, winning tournaments, and keeping your daily streak."
        )

    if any(w in m for w in ["challenge", "play", "compete", "game", "quiz"]):
        return "Challenges are ARTX's core feature — answer correctly to earn prestige and cash. Browse the **Challenges** tab to get started!"

    if any(w in m for w in ["tournament", "competition", "event", "contest"]):
        return "Tournaments are timed events with prize pools. Top scorers share the winnings. Check the **Challenges** section for live events."

    if any(w in m for w in ["alliance", "team", "clan", "group", "squad"]):
        return "Alliances let you team up for group challenges and shared rewards. Visit **Community** to browse or create one."

    if any(w in m for w in ["streak", "daily", "consecutive"]):
        return "Log in and complete at least one challenge every day to build your streak. Longer streaks = more prestige per challenge! 🔥"

    if any(w in m for w in ["payment", "mtn", "airtel", "mpesa", "stripe", "paystack", "mobile money"]):
        return (
            "ARTX supports:\n"
            "📱 **Mobile Money** via PawaPay — MTN, Airtel, M-Pesa\n"
            "💳 **Card payments** via Stripe\n"
            "🏦 **Paystack** — card and bank\n\n"
            "All transactions are in Zambian Kwacha (ZMW)."
        )

    if any(w in m for w in ["thank", "thanks", "cheers", "appreciate"]):
        return "You're welcome! Let me know if there's anything else. 😊"

    if any(w in m for w in ["help", "what can you do", "support"]):
        return (
            "I can help with:\n"
            "💰 Wallet, deposits & withdrawals\n"
            "🎮 Challenges, tournaments & games\n"
            "⭐ Prestige points, tiers & streaks\n"
            "🤝 Alliances & community\n\n"
            "I also answer general questions — just ask!"
        )

    return (
        "I'm running in basic mode and can't answer that right now.\n\n"
        "Add **GROQ_API_KEY** to your `.env` to unlock full AI (free at console.groq.com/keys). "
        "In the meantime, ask me about wallets, challenges, tiers, or anything ARTX-related!"
    )


# ── Main service class ────────────────────────────────────────────────────────

class AIService:
    """
    Primary:  Groq LLaMA 3.3 70B (requires GROQ_API_KEY in .env)
    Fallback: Smart rule-based responses
    """

    def get_response(
        self,
        message: str,
        user_context: dict | None = None,
        history: list | None = None,
    ) -> str:
        history = history or []

        result = _groq_response(message, history, user_context)
        if result:
            return result

        logger.info("Groq unavailable — using rule-based fallback")
        return _rule_based_response(message, user_context)


# Singleton used by views.py
ai_service = AIService()
