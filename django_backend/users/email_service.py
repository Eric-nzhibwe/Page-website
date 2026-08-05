# -*- coding: utf-8 -*-
"""
ARTX Email Service
==================
Sends transactional email via:
  - Resend API  (EMAIL_PROVIDER=resend)  -- HTTPS, works on Render free tier
  - Django SMTP (EMAIL_PROVIDER=smtp)    -- direct SMTP, blocked on Render free
  - Console     (EMAIL_PROVIDER=console) -- prints to stdout, local dev only

Set EMAIL_PROVIDER=resend + RESEND_API_KEY in your environment for production.

Get a free Resend API key (3,000 emails/month free):
  https://resend.com  -> Sign up -> API Keys -> Create Key
"""

import logging
import json
import requests as http_requests
from django.template.loader import render_to_string
from django.conf import settings
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _site_url():
    return getattr(settings, 'FRONTEND_BASE_URL', 'https://artxplatform.com').rstrip('/')


def _from_address():
    return getattr(
        settings, 'DEFAULT_FROM_EMAIL',
        'ARTX Platform <noreply@artxplatform.com>'
    )


def _provider():
    return getattr(settings, 'EMAIL_PROVIDER', 'console').lower()


def _render(template_name, context):
    context.setdefault('site_url', _site_url())
    context.setdefault('from_name', 'ARTX Team')
    html  = render_to_string(f'emails/{template_name}', context)
    plain = strip_tags(html)
    return html, plain


# ─────────────────────────────────────────────────────────────────
# Resend API sender  (HTTPS, works on Render free tier)
# ─────────────────────────────────────────────────────────────────

def _send_via_resend(subject, html_body, plain_body, recipient_email):
    """
    POST to Resend's send endpoint over HTTPS port 443.
    This bypasses the SMTP port-blocking on Render's free plan.
    """
    api_key = getattr(settings, 'RESEND_API_KEY', '')
    if not api_key:
        logger.error('Email FAILED: RESEND_API_KEY is not set.')
        return False

    payload = {
        'from':    _from_address(),
        'to':      [recipient_email],
        'subject': subject,
        'html':    html_body,
        'text':    plain_body,
    }

    try:
        resp = http_requests.post(
            'https://api.resend.com/emails',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type':  'application/json',
            },
            data=json.dumps(payload),
            timeout=15,
        )
        if resp.status_code in (200, 201):
            logger.warning('Email sent OK via Resend: subject="%s" to=%s', subject, recipient_email)
            return True
        else:
            logger.error(
                'Email FAILED via Resend: subject="%s" to=%s | status=%s body=%s',
                subject, recipient_email, resp.status_code, resp.text[:300]
            )
            return False
    except Exception as exc:
        logger.error('Email FAILED via Resend: subject="%s" to=%s | error: %s',
                     subject, recipient_email, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# SMTP sender (local dev / non-Render hosting)
# ─────────────────────────────────────────────────────────────────

def _send_via_smtp(subject, html_body, plain_body, recipient_email):
    from django.core.mail import EmailMultiAlternatives
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=_from_address(),
            to=[recipient_email],
        )
        msg.attach_alternative(html_body, 'text/html')
        msg.send(fail_silently=False)
        logger.warning('Email sent OK via SMTP: subject="%s" to=%s', subject, recipient_email)
        return True
    except Exception as exc:
        logger.error('Email FAILED via SMTP: subject="%s" to=%s | error: %s',
                     subject, recipient_email, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# Console sender (development only)
# ─────────────────────────────────────────────────────────────────

def _send_via_console(subject, html_body, plain_body, recipient_email):
    print('\n' + '=' * 60)
    print(f'[ARTX EMAIL - CONSOLE MODE]')
    print(f'To:      {recipient_email}')
    print(f'Subject: {subject}')
    print('-' * 60)
    print(plain_body[:800])
    print('=' * 60 + '\n')
    return True


# ─────────────────────────────────────────────────────────────────
# Dispatcher
# ─────────────────────────────────────────────────────────────────

def _send(subject, template_name, context, recipient_email):
    """
    Render the template and dispatch via the configured provider.
    Returns True on success, False on failure (never raises).
    """
    try:
        html_body, plain_body = _render(template_name, context)
    except Exception as exc:
        logger.error('Email template render failed: %s | error: %s', template_name, exc)
        return False

    provider = _provider()

    if provider == 'resend':
        return _send_via_resend(subject, html_body, plain_body, recipient_email)
    elif provider == 'smtp':
        return _send_via_smtp(subject, html_body, plain_body, recipient_email)
    else:
        # console (default for local dev)
        return _send_via_console(subject, html_body, plain_body, recipient_email)


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

class EmailService:

    def send_welcome(self, user):
        return _send(
            subject='Welcome to ARTX Platform! 🎮',
            template_name='welcome.html',
            context={
                'user':      user,
                'username':  user.username,
                'login_url': f'{_site_url()}/pages/auth.html',
            },
            recipient_email=user.email,
        )

    def send_login_notification(self, user, ip_address='Unknown', device='Unknown browser'):
        from django.utils import timezone
        return _send(
            subject='New sign-in to your ARTX account',
            template_name='login_notification.html',
            context={
                'user':        user,
                'username':    user.username,
                'ip_address':  ip_address,
                'device':      device,
                'login_time':  timezone.now().strftime('%d %b %Y, %H:%M UTC'),
                'support_url': f'{_site_url()}/pages/auth.html',
            },
            recipient_email=user.email,
        )

    def send_otp(self, user, otp, expiry_minutes=10):
        # Try HTML template first; fall back to plain text
        try:
            return _send(
                subject='Your ARTX verification code',
                template_name='otp.html',
                context={
                    'user':           user,
                    'username':       user.username,
                    'otp':            otp,
                    'expiry_minutes': expiry_minutes,
                },
                recipient_email=user.email,
            )
        except Exception:
            return self._otp_plain_fallback(user, otp, expiry_minutes)

    def _otp_plain_fallback(self, user, otp, expiry_minutes):
        """
        Emergency plain-text OTP send when the template is missing.
        Uses the same provider routing as everything else.
        """
        html  = (
            f'<p>Hi <b>{user.username}</b>,</p>'
            f'<p>Your ARTX verification code is: <b style="font-size:24px">{otp}</b></p>'
            f'<p>Expires in {expiry_minutes} minutes.</p>'
            f'<p>If you did not request this, ignore this email.</p>'
        )
        plain = (
            f'Hi {user.username},\n\n'
            f'Your ARTX verification code is: {otp}\n\n'
            f'It expires in {expiry_minutes} minutes.\n\n'
            f'-- ARTX Team'
        )
        provider = _provider()
        if provider == 'resend':
            return _send_via_resend('Your ARTX verification code', html, plain, user.email)
        elif provider == 'smtp':
            return _send_via_smtp('Your ARTX verification code', html, plain, user.email)
        else:
            return _send_via_console('Your ARTX verification code', html, plain, user.email)

    def send_tier_upgrade(self, user, old_tier, new_tier):
        return _send(
            subject=f'You reached {new_tier} Tier on ARTX!',
            template_name='tier_upgrade.html',
            context={
                'user':          user,
                'username':      user.username,
                'old_tier':      old_tier,
                'new_tier':      new_tier,
                'dashboard_url': f'{_site_url()}/pages/user.html',
            },
            recipient_email=user.email,
        )

    def send_alliance_created(self, user, alliance_name):
        return _send(
            subject=f'Alliance "{alliance_name}" created!',
            template_name='alliance_created.html',
            context={
                'user':          user,
                'username':      user.username,
                'alliance_name': alliance_name,
                'dashboard_url': f'{_site_url()}/pages/user.html',
            },
            recipient_email=user.email,
        )

    def send_alliance_joined(self, user, alliance_name):
        return _send(
            subject=f'You joined "{alliance_name}"!',
            template_name='alliance_join.html',
            context={
                'user':          user,
                'username':      user.username,
                'alliance_name': alliance_name,
                'dashboard_url': f'{_site_url()}/pages/user.html',
            },
            recipient_email=user.email,
        )

    def send_password_reset(self, user, reset_url, expiry_hours=1):
        return _send(
            subject='Reset your ARTX password',
            template_name='password_reset.html',
            context={
                'user':         user,
                'username':     user.username,
                'reset_url':    reset_url,
                'expiry_hours': expiry_hours,
            },
            recipient_email=user.email,
        )


# Module-level singleton
email_service = EmailService()
