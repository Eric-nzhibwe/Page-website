# -*- coding: utf-8 -*-
"""
PAGE Email Service
==================
Sends transactional email via:
  - SendGrid API (EMAIL_PROVIDER=sendgrid) -- HTTPS, no domain needed, free 100/day
  - Resend API   (EMAIL_PROVIDER=resend)   -- HTTPS, works on Render free tier
  - Django SMTP  (EMAIL_PROVIDER=smtp)     -- direct SMTP, blocked on Render free
  - Console      (EMAIL_PROVIDER=console)  -- prints to stdout, local dev only

Recommended for production without a custom domain:
  SendGrid -> sign up at sendgrid.com -> Settings -> API Keys -> Create Key
             -> Settings -> Sender Authentication -> Single Sender Verification
  Set EMAIL_PROVIDER=sendgrid and SENDGRID_API_KEY in your environment.
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
    return getattr(settings, 'FRONTEND_BASE_URL', 'https://page-website.onrender.com').rstrip('/')


def _from_address():
    return getattr(
        settings, 'DEFAULT_FROM_EMAIL',
        'PAGE Platform <noreply@pageplatform.com>'
    )


def _provider():
    return getattr(settings, 'EMAIL_PROVIDER', 'console').lower()


def _render(template_name, context):
    context.setdefault('site_url', _site_url())
    context.setdefault('from_name', 'PAGE Team')
    html  = render_to_string(f'emails/{template_name}', context)
    plain = strip_tags(html)
    return html, plain


def _parse_from_address():
    """
    Split 'Display Name <email@example.com>' into (name, email).
    Falls back gracefully if the format is just a plain email address.
    """
    raw = _from_address    if '<' in raw and raw.endswith('>'):
        name, _, addr = raw.partition('<')
        return name.strip(), addr.rstrip('>')
    return 'PAGE Platform', raw.strip()


# ─────────────────────────────────────────────────────────────────
# SendGrid API sender (HTTPS, single sender — no domain needed)
# ─────────────────────────────────────────────────────────────────

def _send_via_sendgrid(subject, html_body, plain_body, recipient_email):
    """
    POST to SendGrid's v3 /mail/send endpoint over HTTPS.
    Requires only a verified single sender email — no custom domain needed.
    Free tier: 100 emails/day forever.
    """
    api_key = getattr(settings, 'SENDGRID_API_KEY', '')
    if not api_key:
        logger.error('Email FAILED: SENDGRID_API_KEY is not set.')
        return False

    from_name, from_email = _parse_from_address()

    payload = {
        'personalizations': [
            {
                'to': [{'email': recipient_email}],
                'subject': subject,
            }
        ],
        'from': {'email': from_email, 'name': from_name},
        'content': [
            {'type': 'text/plain', 'value': plain_body},
            {'type': 'text/html',  'value': html_body},
        ],
    }

    try:
        resp = http_requests.post(
            'https://api.sendgrid.com/v3/mail/send',
            headers={
                'Authorization': f'Bearer {api_key}',
                'Content-Type':  'application/json',
            },
            data=json.dumps(payload),
            timeout=15,
        )
        # SendGrid returns 202 Accepted on success (no body)
        if resp.status_code == 202:
            logger.info('Email sent OK via SendGrid: subject="%s" to=%s', subject, recipient_email)
            return True
        else:
            logger.error(
                'Email FAILED via SendGrid: subject="%s" to=%s | status=%s body=%s',
                subject, recipient_email, resp.status_code, resp.text[:300]
            )
            return False
    except Exception as exc:
        logger.error('Email FAILED via SendGrid: subject="%s" to=%s | error: %s',
                     subject, recipient_email, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# Resend API sender (HTTPS, works on Render free tier)
# ─────────────────────────────────────────────────────────────────

def _send_via_resend(subject, html_body, plain_body, recipient_email):
    """
    POST to Resend's send endpoint over HTTPS port 443.
    Use from address 'onboarding@resend.dev' if you have no verified domain.
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
            logger.info('Email sent OK via Resend: subject="%s" to=%s', subject, recipient_email)
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
        from django.utils import timezone
        return _send(dy, 'text/html')
        msg.send(fail_silently=False)
        logger.info('Email sent OK via SMTP: subject="%s" to=%s', subject, recipient_email)
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
    print('[PAGE EMAIL - CONSOLE MODE]')
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

    if provider == 'sendgrid':
        return _send_via_sendgrid(subject, html_body, plain_body, recipient_email)
    elif provider == 'resend':
        return _send_via_resend(subject, html_body, plain_body, recipient_email)
    elif provider == 'smtp':
        return _send_via_smtp(subject, html_body, plain_body, recipient_email)
    else:
        return _send_via_console(subject, html_body, plain_body, recipient_email)


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

class EmailService:

    def send_welcome(self, user):
        return _send(
            subject='Welcome to PAGE! 🎮',
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
            subject='New sign-in to your PAGE account',
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
        try:
            return _send(
                subject='Your PAGE verification code',
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
        """Plain-text OTP fallback when the template is missing."""
        html = (
            f'<p>Hi <b>{user.username}</b>,</p>'
            f'<p>Your PAGE verification code is: <b style="font-size:24px">{otp}</b></p>'
            f'<p>Expires in {expiry_minutes} minutes.</p>'
            f'<p>If you did not request this, ignore this email.</p>'
        )
        plain = (
            f'Hi {user.username},\n\n'
            f'Your PAGE verification code is: {otp}\n\n'
            f'It expires in {expiry_minutes} minutes.\n\n'
            f'-- PAGE Team'
        )
        provider = _provider()
        if provider == 'sendgrid':
            return _send_via_sendgrid('Your PAGE verification code', html, plain, user.email)
        elif provider == 'resend':
            return _send_via_resend('Your PAGE verification code', html, plain, user.email)
        elif provider == 'smtp':
            return _send_via_smtp('Your PAGE verification code', html, plain, user.email)
        else:
            return _send_via_console('Your PAGE verification code', html, plain, user.email)

    def send_tier_upgrade(self, user, old_tier, new_tier):
        return _send(
            subject=f'You reached {new_tier} Tier on PAGE!',
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
            subject='Reset your PAGE password',
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
