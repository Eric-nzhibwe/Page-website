"""
ARTX AI Service — powered by Google Gemini
============================================
Primary:  Google Gemini 1.5 Flash (free tier)
Fallback: Smart rule-based responses

Setup:
  1. pip install google-generativeai==0.8.3
  2. Add GEMINI_API_KEY=<your_key> to your .env file
  3. Get a free key at https://aistudio.google.com/app/apikey
"""
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


# ── System prompt — defines Gemini's personality ──────────────────────────────

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


def _build_gemini_system(user_context: dict | None) -> str:
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


def _gemini_response(
    message: str,
    history: list,
    user_context: dict | None,
) -> str | None:
    """
    Call Gemini 1.5 Flash with full conversation history.

    history items: {"role": "user"|"assistant", "content": "..."}
    Returns the response text, or None if Gemini is unavailable.
    """
    api_key = getattr(settings, "GEMINI_API_KEY", None)
    if not api_key:
        logger.warning("GEMINI_API_KEY not set — falling back to rule-based responses.")
        return None

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)

        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=_build_gemini_system(user_context),
            generation_config={
                "temperature": 0.75,
                "max_output_tokens": 700,
                "top_p": 0.95,
            },
            safety_settings=[
                # Relax safety filters slightly so gaming/competition talk isn't blocked
                {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
            ],
        )

        # Convert history to Gemini format (role: "user" | "model")
        gemini_history = []
        for turn in history[-20:]:  # last 10 exchanges
            role = "model" if turn.get("role") == "assistant" else "user"
            content = turn.get("content", "").strip()
            if content:
                gemini_history.append({"role": role, "parts": [content]})

        chat = model.start_chat(history=gemini_history)
        response = chat.send_message(message)
        return response.text.strip()

    except ImportError:
        logger.error("google-generativeai not installed. Run: pip install google-generativeai==0.8.3")
        return None
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return None


# ── Smart rule-based fallback ─────────────────────────────────────────────────

def _rule_based_response(message: str, user_context: dict | None) -> str:
    """
    Covers the most common queries when Gemini is unavailable.
    Honest about its limitations and always tells the user how to enable Gemini.
    """
    m = message.lower()
    ctx = user_context or {}

    # ── Greetings
    if any(w in m for w in ["hi", "hello", "hey", "howdy", "sup", "good morning", "good evening"]):
        name = ctx.get("username", "there")
        return f"Hey {name}! 👋 I'm ARTX AI. Ask me about your wallet, challenges, tiers — or anything else!"

    if any(w in m for w in ["how are you", "how r u", "you okay", "hows it"]):
        return "Doing great, thanks! How can I help you today? 😊"

    # ── Wallet / balance
    if any(w in m for w in ["balance", "how much", "my wallet", "my money"]):
        bal = ctx.get("wallet_balance")
        if bal is not None:
            return f"Your current wallet balance is **K{float(bal):.2f}**. Want to top it up or make a withdrawal?"
        return "Head to the **Wallet** page to check your balance. You can deposit via mobile money (MTN/Airtel) or card anytime."

    if any(w in m for w in ["deposit", "add money", "top up", "fund my"]):
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

    # ── Prestige / tiers
    if any(w in m for w in ["prestige", "tier", "level", "rank", "points", "bronze", "gold", "diamond", "legendary"]):
        pts  = ctx.get("prestige_points")
        tier = ctx.get("tier")
        intro = f"You're at **{pts} prestige points** — **{tier} tier**.\n\n" if pts is not None else ""
        return (
            intro
            + "Tier ladder:\n"
            "🥉 Bronze → 🥈 Silver → 🥇 Gold → 💎 Platinum → 💠 Diamond → ⭐ Elite → 🏆 Legendary\n\n"
            "Earn points by completing challenges, winning tournaments, and keeping your daily streak."
        )

    # ── Challenges / games
    if any(w in m for w in ["challenge", "play", "compete", "game", "quiz", "question"]):
        return "Challenges are ARTX's core feature — answer correctly to earn prestige and cash. Browse the **Challenges** tab to find one that matches your level!"

    # ── Tournaments
    if any(w in m for w in ["tournament", "competition", "event", "contest"]):
        return "Tournaments are timed events with prize pools. Top scorers share the winnings. Check the **Challenges** section for what's live right now."

    # ── Alliances
    if any(w in m for w in ["alliance", "team", "clan", "group", "squad"]):
        return "Alliances let you team up for group challenges and shared rewards. Visit **Community** to browse existing alliances or create your own."

    # ── Streaks
    if any(w in m for w in ["streak", "daily", "consecutive", "login bonus"]):
        return "Log in and complete at least one challenge every day to build your streak. The longer your streak, the more prestige you earn per challenge! 🔥"

    # ── Payments
    if any(w in m for w in ["payment", "mtn", "airtel", "mpesa", "stripe", "paystack", "pawapay", "mobile money"]):
        return (
            "ARTX supports:\n"
            "📱 **Mobile Money** via PawaPay — MTN, Airtel, M-Pesa\n"
            "💳 **Card payments** via Stripe\n"
            "🏦 **Paystack** — card and bank\n\n"
            "All transactions are in Zambian Kwacha (ZMW)."
        )

    # ── Messenger
    if any(w in m for w in ["message", "messenger", "dm", "inbox", "chat with"]):
        return "The **Messenger** lets you send real-time messages and media to any ARTX user. Find it in your profile menu."

    # ── Help
    if any(w in m for w in ["help", "what can you do", "support", "guide", "how do i"]):
        return (
            "I can help you with:\n"
            "💰 Wallet, deposits & withdrawals\n"
            "🎮 Challenges, tournaments & games\n"
            "⭐ Prestige points, tiers & streaks\n"
            "🤝 Alliances & community\n"
            "💬 Messaging & platform features\n\n"
            "I also answer general questions — just ask!"
        )

    # ── Thanks
    if any(w in m for w in ["thank", "thanks", "cheers", "appreciate", "great job"]):
        return "You're welcome! Let me know if there's anything else I can help with. 😊"

    # ── Unknown — honest about the fallback
    return (
        "I'm running in basic mode right now and don't have a specific answer for that.\n\n"
        "To unlock full AI responses (like ChatGPT), add your **GEMINI_API_KEY** to the `.env` file "
        "and restart the server. Get a free key at https://aistudio.google.com/app/apikey\n\n"
        "In the meantime, try asking about your wallet, challenges, tiers, or anything ARTX-related!"
    )


# ── Main service class ────────────────────────────────────────────────────────

class AIService:
    """
    Primary: Google Gemini 1.5 Flash (requires GEMINI_API_KEY in .env)
    Fallback: Smart rule-based responses

    Usage:
        from chatbot.ai_service import ai_service
        reply = ai_service.get_response(
            message="How do I withdraw money?",
            user_context={"username": "eric", "wallet_balance": 250.00, "tier": "Gold"},
            history=[{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]
        )
    """

    def get_response(
        self,
        message: str,
        user_context: dict | None = None,
        history: list | None = None,
    ) -> str:
        history = history or []

        # Try Gemini first
        result = _gemini_response(message, history, user_context)
        if result:
            return result

        # Fallback to rule-based
        logger.info("Gemini unavailable — using rule-based fallback")
        return _rule_based_response(message, user_context)


# Singleton used by views.py
ai_service = AIService()
