"""
OTP Service for Two-Factor Authentication
"""
import random
import string
from datetime import datetime, timedelta
from django.core.cache import cache
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


class OTPService:
    """Handle OTP generation, validation, and delivery"""
    
    OTP_LENGTH = 6
    OTP_EXPIRY_MINUTES = 10
    MAX_ATTEMPTS = 3
    RESEND_COOLDOWN_SECONDS = 60
    
    @staticmethod
    def generate_otp():
        """Generate a random 6-digit OTP"""
        return ''.join(random.choices(string.digits, k=OTPService.OTP_LENGTH))
    
    @staticmethod
    def generate_session_id():
        """Generate a unique session ID"""
        return ''.join(random.choices(string.ascii_letters + string.digits, k=32))
    
    @staticmethod
    def create_otp(user, session_id=None):
        """
        Create and store OTP for user
        Returns: (otp, session_id)
        """
        if not session_id:
            session_id = OTPService.generate_session_id()
        
        otp = OTPService.generate_otp()
        
        # Store OTP in cache with expiry
        cache_key = f'otp_{session_id}'
        cache_data = {
            'otp': otp,
            'user_id': user.id,
            'username': user.username,
            'attempts': 0,
            'created_at': datetime.now().isoformat()
        }
        
        cache.set(cache_key, cache_data, timeout=OTPService.OTP_EXPIRY_MINUTES * 60)
        
        logger.info(f"OTP created for user {user.username} (session: {session_id})")
        
        return otp, session_id
    
    @staticmethod
    def verify_otp(session_id, otp_input):
        """
        Verify OTP
        Returns: (success, message, user_id)
        """
        cache_key = f'otp_{session_id}'
        cache_data = cache.get(cache_key)
        
        if not cache_data:
            return False, 'OTP expired or invalid session', None
        
        # Check attempts
        if cache_data['attempts'] >= OTPService.MAX_ATTEMPTS:
            cache.delete(cache_key)
            return False, 'Maximum attempts exceeded. Please request a new OTP.', None
        
        # Verify OTP
        if cache_data['otp'] != otp_input:
            # Increment attempts
            cache_data['attempts'] += 1
            cache.set(cache_key, cache_data, timeout=OTPService.OTP_EXPIRY_MINUTES * 60)
            
            remaining = OTPService.MAX_ATTEMPTS - cache_data['attempts']
            return False, f'Invalid OTP. {remaining} attempts remaining.', None
        
        # OTP is correct
        user_id = cache_data['user_id']
        username = cache_data['username']
        
        # Delete OTP from cache
        cache.delete(cache_key)
        
        logger.info(f"OTP verified successfully for user {username}")
        
        return True, 'OTP verified successfully', user_id
    
    @staticmethod
    def can_resend(session_id):
        """Check if OTP can be resent"""
        resend_key = f'otp_resend_{session_id}'
        last_sent = cache.get(resend_key)
        
        if last_sent:
            return False, 'Please wait before requesting another OTP'
        
        return True, 'OK'
    
    @staticmethod
    def mark_resent(session_id):
        """Mark OTP as resent to enforce cooldown"""
        resend_key = f'otp_resend_{session_id}'
        cache.set(resend_key, datetime.now().isoformat(), 
                 timeout=OTPService.RESEND_COOLDOWN_SECONDS)
    
    @staticmethod
    def send_otp_email(user, otp):
        """Send OTP via email using the central email service."""
        from users.email_service import email_service
        result = email_service.send_otp(user, otp, OTPService.OTP_EXPIRY_MINUTES)
        if result:
            logger.info(f"OTP email sent to {user.email}")
        else:
            logger.error(f"Failed to send OTP email to {user.email}")
        return result
    
    @staticmethod
    def send_otp_sms(user, otp):
        """Send OTP via SMS (placeholder for future implementation)"""
        # TODO: Implement SMS sending via Twilio, AWS SNS, or other provider
        logger.info(f"SMS OTP sending not implemented yet. OTP: {otp}")
        return False


# Singleton instance
otp_service = OTPService()
