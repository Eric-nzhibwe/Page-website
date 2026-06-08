"""
OTP Service for Two-Factor Authentication
"""
import random
import string
from datetime import datetime, timedelta
from django.core.cache import cache
from django.core.mail import send_mail
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
        """Send OTP via email"""
        try:
            subject = 'ARTX - Your Verification Code'
            message = f"""
Hello {user.username},

Your ARTX verification code is:

{otp}

This code will expire in {OTPService.OTP_EXPIRY_MINUTES} minutes.

If you didn't request this code, please ignore this email.

Best regards,
ARTX Team
            """
            
            html_message = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
        }}
        .container {{
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            border-radius: 10px 10px 0 0;
        }}
        .content {{
            background: #f8f9fa;
            padding: 30px;
            border-radius: 0 0 10px 10px;
        }}
        .otp-box {{
            background: white;
            border: 2px solid #667eea;
            border-radius: 10px;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
        }}
        .otp-code {{
            font-size: 32px;
            font-weight: bold;
            color: #667eea;
            letter-spacing: 8px;
            font-family: monospace;
        }}
        .footer {{
            text-align: center;
            color: #666;
            font-size: 12px;
            margin-top: 20px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 ARTX Verification</h1>
        </div>
        <div class="content">
            <p>Hello <strong>{user.username}</strong>,</p>
            <p>Your ARTX verification code is:</p>
            
            <div class="otp-box">
                <div class="otp-code">{otp}</div>
            </div>
            
            <p>This code will expire in <strong>{OTPService.OTP_EXPIRY_MINUTES} minutes</strong>.</p>
            <p>If you didn't request this code, please ignore this email.</p>
            
            <div class="footer">
                <p>Best regards,<br>ARTX Team</p>
                <p>🔒 This is an automated message. Please do not reply.</p>
            </div>
        </div>
    </div>
</body>
</html>
            """
            
            send_mail(
                subject=subject,
                message=message,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                html_message=html_message,
                fail_silently=False
            )
            
            logger.info(f"OTP email sent to {user.email}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send OTP email: {e}")
            return False
    
    @staticmethod
    def send_otp_sms(user, otp):
        """Send OTP via SMS (placeholder for future implementation)"""
        # TODO: Implement SMS sending via Twilio, AWS SNS, or other provider
        logger.info(f"SMS OTP sending not implemented yet. OTP: {otp}")
        return False


# Singleton instance
otp_service = OTPService()
