"""
AI Service for chatbot
Supports OpenAI GPT and rule-based fallback
"""
import os
import json
import logging
from django.conf import settings

logger = logging.getLogger(__name__)


class AIService:
    """AI service with OpenAI and rule-based fallback"""
    
    def __init__(self):
        self.openai_available = self._check_openai()
    
    def _check_openai(self):
        """Check if OpenAI is available"""
        try:
            import openai
            api_key = getattr(settings, 'OPENAI_API_KEY', None)
            if api_key:
                openai.api_key = api_key
                return True
        except ImportError:
            pass
        return False
    
    def get_response(self, message, user_context=None):
        """Get AI response"""
        if self.openai_available:
            return self._get_openai_response(message, user_context)
        else:
            return self._get_rule_based_response(message, user_context)
    
    def _get_openai_response(self, message, user_context):
        """Get response from OpenAI GPT"""
        try:
            import openai
            
            # Build system prompt with context
            system_prompt = self._build_system_prompt(user_context)
            
            response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message}
                ],
                max_tokens=500,
                temperature=0.7
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"OpenAI error: {e}")
            return self._get_rule_based_response(message, user_context)
    
    def _build_system_prompt(self, user_context):
        """Build system prompt with user context"""
        prompt = """You are ARTX AI Assistant, a helpful chatbot for the ARTX gaming platform.

ARTX Platform Features:
- Competitive challenges and games
- Prestige points and tier system (Bronze to Legendary)
- Wallet system with deposits and withdrawals (Zambian Kwacha - ZMW)
- Mobile money payments via PawaPay (MTN, Airtel)
- Tournaments and alliances
- Messenger for user communication

Your role:
- Help users understand platform features
- Guide them through challenges and games
- Assist with wallet and payment questions
- Provide friendly, concise responses
- Use emojis occasionally for friendliness

"""
        
        if user_context:
            prompt += f"\nCurrent User Context:\n"
            if 'username' in user_context:
                prompt += f"- Username: {user_context['username']}\n"
            if 'prestige_points' in user_context:
                prompt += f"- Prestige Points: {user_context['prestige_points']}\n"
            if 'tier' in user_context:
                prompt += f"- Tier: {user_context['tier']}\n"
            if 'wallet_balance' in user_context:
                prompt += f"- Wallet Balance: K{user_context['wallet_balance']}\n"
        
        return prompt
    
    def _get_rule_based_response(self, message, user_context):
        """Get rule-based response (fallback)"""
        message_lower = message.lower()
        
        # Greeting responses
        if any(word in message_lower for word in ['hello', 'hi', 'hey', 'greetings']):
            username = user_context.get('username', 'there') if user_context else 'there'
            return f"👋 Hello {username}! I'm ARTX AI Assistant. How can I help you today?"
        
        # Wallet questions
        if any(word in message_lower for word in ['how does my wallet work?', 'how do i check for my balance?', 'money', 'how do i make a deposit?', 'how do i withdraw?']):
            if user_context and 'wallet_balance' in user_context:
                balance = user_context['wallet_balance']
                return f"💰 Your current wallet balance is K{balance}. You can deposit funds using mobile money (MTN, Airtel) or card payments. Would you like help with deposits or withdrawals?"
            return "💰 Your wallet stores your earnings and deposits. You can add funds via mobile money (PawaPay) or card (Stripe), and withdraw anytime. Visit the Wallet page to manage your funds!"
        
        # Challenge questions
        if any(word in message_lower for word in ['challenge', 'game', 'play', 'compete']):
            return "🎮 ARTX offers competitive challenges where you can earn prestige points and money! Submit correct answers to climb the leaderboards. Check out the Challenges page to get started!"
        
        # Prestige/tier questions
        if any(word in message_lower for word in ['prestige', 'points', 'tier', 'level', 'rank']):
            if user_context:
                prestige = user_context.get('prestige_points', 0)
                tier = user_context.get('tier', 'Bronze')
                return f"⭐ You have {prestige} prestige points and are in the {tier} tier! Earn more points by completing challenges. Higher tiers unlock better rewards and features!"
            return "⭐ Prestige points show your skill level! Earn them by completing challenges. Climb from Bronze → Silver → Gold → Platinum → Diamond → Elite → Legendary!"
        
        # Payment questions
        if any(word in message_lower for word in ['payment', 'pay', 'mtn', 'airtel', 'mobile money', 'pawapay']):
            return "💳 We support mobile money payments via PawaPay (MTN, Airtel) and card payments via Stripe. All transactions are in Zambian Kwacha (ZMW). Deposits are instant!"
        
        # Tournament questions
        if any(word in message_lower for word in ['tournament', 'competition', 'event']):
            return "🏆 Tournaments are competitive events where you can win prizes! Join tournaments to compete against other players and climb the rankings. Check the Tournaments section!"
        
        # Alliance questions
        if any(word in message_lower for word in ['alliance', 'team', 'group', 'clan']):
            return "🤝 Alliances let you team up with other players! Create or join an alliance to compete together, share strategies, and earn group rewards. Visit the Community page!"
        
        # Help/support
        if any(word in message_lower for word in ['help', 'support', 'how', 'what', 'guide']):
            return "❓ I can help you with:\n• Wallet & payments\n• Challenges & games\n• Prestige & tiers\n• Tournaments\n• Alliances\n\nWhat would you like to know more about?"
        
        # Thank you
        if any(word in message_lower for word in ['thank', 'thanks', 'appreciate']):
            return "😊 You're welcome! Let me know if you need anything else. Happy gaming!"
        
        # Default response
        return "🤖 I'm here to help! Ask me about:\n• Your wallet and balance\n• How to play challenges\n• Prestige points and tiers\n• Payments and withdrawals\n• Tournaments and alliances\n\nWhat would you like to know?"


# Global AI service instance
ai_service = AIService()
