# -*- coding: utf-8 -*-
"""
ARTX SMS Service
================
Sends transactional SMS via:
  - Twilio           (SMS_PROVIDER=twilio)         -- global coverage, reliable
  - Africa's Talking (SMS_PROVIDER=africastalking) -- better rates for African numbers
  - Console          (SMS_PROVIDER=console)         -- prints to stdout, dev only

Set SMS_PROVIDER + credentials in your .env for production.

Twilio free trial: https://www.twilio.com/try-twilio
Africa's Talking sandbox: https://africastalking.com/
"""

import logging
from django.conf import settings

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _provider():
    return getattr(settings, 'SMS_PROVIDER', 'console').lower()


def _has_phone(user):
    """Return the user's phone number, or None if not set."""
    number = getattr(user, 'phone', None) or ''
    return number.strip() or None


# ─────────────────────────────────────────────────────────────────
# Twilio sender
# ─────────────────────────────────────────────────────────────────

def _send_via_twilio(to_number: str, message: str) -> bool:
    """Send SMS using Twilio's REST API."""
    account_sid = getattr(settings, 'TWILIO_ACCOUNT_SID', '')
    auth_token  = getattr(settings, 'TWILIO_AUTH_TOKEN', '')
    from_number = getattr(settings, 'TWILIO_PHONE_NUMBER', '')

    if not all([account_sid, auth_token, from_number]):
        logger.error('SMS FAILED via Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, '
                     'or TWILIO_PHONE_NUMBER is not set.')
        return False

    try:
        from twilio.rest import Client
        client = Client(account_sid, auth_token)
        client.messages.create(
            body=message,
            from_=from_number,
            to=to_number,
        )
        logger.warning('SMS sent OK via Twilio to %s', to_number)
        return True
    except Exception as exc:
        logger.error('SMS FAILED via Twilio to %s | error: %s', to_number, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# Africa's Talking sender
# ─────────────────────────────────────────────────────────────────

def _send_via_africastalking(to_number: str, message: str) -> bool:
    """Send SMS using Africa's Talking API."""
    username  = getattr(settings, 'AFRICASTALKING_USERNAME', '')
    api_key   = getattr(settings, 'AFRICASTALKING_API_KEY', '')
    sender_id = getattr(settings, 'AFRICASTALKING_SENDER_ID', '') or None

    if not username or not api_key:
        logger.error('SMS FAILED via Africa\'s Talking: AFRICASTALKING_USERNAME '
                     'or AFRICASTALKING_API_KEY is not set.')
        return False

    try:
        import africastalking
        africastalking.initialize(username, api_key)
        sms      = africastalking.SMS
        response = sms.send(message, [to_number], sender_id=sender_id)

        recipients = response.get('SMSMessageData', {}).get('Recipients', [])
        if recipients and recipients[0].get('status') == 'Success':
            logger.warning("SMS sent OK via Africa's Talking to %s", to_number)
            return True

        logger.error("SMS FAILED via Africa's Talking to %s | response: %s",
                     to_number, response)
        return False
    except Exception as exc:
        logger.error("SMS FAILED via Africa's Talking to %s | error: %s", to_number, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# Console sender (development only)
# ─────────────────────────────────────────────────────────────────

def _send_via_console(to_number: str, message: str) -> bool:
    print('\n' + '=' * 60)
    print('[ARTX SMS - CONSOLE MODE]')
    print(f'To:      {to_number}')
    print(f'Message: {message}')
    print('=' * 60 + '\n')
    return True


# ─────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────

def _send(to_number: str, message: str) -> bool:
    """
    Dispatch SMS via the configured provider.
    Returns True on success, False on failure (never raises).
    """
    if not to_number:
        logger.warning('SMS skipped: no phone number provided.')
        return False

    provider = _provider()

    if provider == 'twilio':
        return _send_via_twilio(to_number, message)
    elif provider == 'africastalking':
        return _send_via_africastalking(to_number, message)
    else:
        # console (default for local dev)
        return _send_via_console(to_number, message)


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

class SMSService:

    def send_otp(self, user, otp: str, expiry_minutes: int = 10) -> bool:
        """Send OTP verification code via SMS."""
        phone = _has_phone(user)
        if not phone:
            logger.info('SMS OTP skipped for %s: no phone number on file.', user.username)
            return False

        message = (
            f'Your ARTX verification code is: {otp}\n'
            f'Expires in {expiry_minutes} minutes. Do not share it.'
        )
        return _send(phone, message)

    def send_login_alert(self, user) -> bool:
        """Notify user of a new sign-in via SMS."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            'New sign-in detected on your ARTX account. '
            'Not you? Contact support immediately at artxplatform.com'
        )
        return _send(phone, message)

    def send_tier_upgrade(self, user, new_tier: str) -> bool:
        """Congratulate user on reaching a new tier via SMS."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            f'ARTX: Congrats! You just reached {new_tier} Tier! '
            f'Keep competing to unlock more rewards!'
        )
        return _send(phone, message)

    def send_alliance_invite(self, user, alliance_name: str) -> bool:
        """Notify user of an alliance invitation via SMS."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            f'ARTX: You\'ve been invited to join the "{alliance_name}" alliance! '
            f'Log in to accept.'
        )
        return _send(phone, message)

    def send_alliance_created(self, user, alliance_name: str) -> bool:
        """Confirm alliance creation to the founder via SMS."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            f'ARTX: Your alliance "{alliance_name}" has been created successfully! '
            f'Invite your crew and start competing.'
        )
        return _send(phone, message)

    def send_password_reset(self, user, reset_url: str) -> bool:
        """Send password reset link via SMS as a fallback channel."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            f'ARTX: Password reset requested. Use this link (expires in 1h):\n'
            f'{reset_url}\n'
            f'Ignore this if you did not request a reset.'
        )
        return _send(phone, message)

    def send_welcome(self, user) -> bool:
        """Send a welcome SMS to new users."""
        phone = _has_phone(user)
        if not phone:
            return False

        message = (
            f'Welcome to ARTX, {user.username}! '
            f'Your account is ready. Start competing and earn prestige!'
        )
        return _send(phone, message)


# Module-level singleton
sms_service = SMSService()
