"""
ARTX Email Service
==================
Single module for all transactional emails.
Uses Django's template engine so templates/emails/*.html are the
single source of truth for email content.

Usage
-----
    from users.email_service import email_service
    email_service.send_welcome(user)
    email_service.send_login_notification(user, ip, device)
    email_service.send_otp(user, otp)
    email_service.send_tier_upgrade(user, old_tier, new_tier)
"""

import logging
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.conf import settings
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)


def _site_url():
    return getattr(settings, 'FRONTEND_BASE_URL',
                   'https://artxplatform.com').rstrip('/')


def _from():
    return getattr(settings, 'DEFAULT_FROM_EMAIL', 'ARTX Platform <noreply@artxplatform.com>')


def _send(subject, template_name, context, recipient_email):
    """
    Render an HTML template, derive a plain-text version by stripping
    tags, and send via Django's email backend (SMTP or console).
    Returns True on success, False on failure.
    """
    context.setdefault('site_url', _site_url())
    context.setdefault('from_name', 'ARTX Team')

    try:
        html_body  = render_to_string(f'emails/{template_name}', context)
        plain_body = strip_tags(html_body)

        msg = EmailMultiAlternatives(
            subject=subject,
            body=plain_body,
            from_email=_from(),
            to=[recipient_email],
        )
        msg.attach_alternative(html_body, 'text/html')
        msg.send(fail_silently=False)

        logger.warning('Email sent OK: subject="%s" to=%s', subject, recipient_email)
        return True

    except Exception as exc:
        logger.error('Email FAILED: subject="%s" to=%s | error: %s',
                     subject, recipient_email, exc)
        return False


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────

class EmailService:

    # ── Welcome ──────────────────────────────────────────────────
    def send_welcome(self, user):
        """
        Sent immediately after successful registration.
        Template: templates/emails/welcome.html
        """
        return _send(
            subject='Welcome to ARTX Platform! 🎮',
            template_name='welcome.html',
            context={
                'user':       user,
                'username':   user.username,
                'login_url':  f'{_site_url()}/pages/auth.html',
            },
            recipient_email=user.email,
        )

    # ── Login notification ────────────────────────────────────────
    def send_login_notification(self, user, ip_address='Unknown',
                                 device='Unknown browser'):
        """
        Sent after every successful login.
        Template: templates/emails/login_notification.html
        """
        from django.utils import timezone
        return _send(
            subject='New sign-in to your ARTX account',
            template_name='login_notification.html',
            context={
                'user':       user,
                'username':   user.username,
                'ip_address': ip_address,
                'device':     device,
                'login_time': timezone.now().strftime('%d %b %Y, %H:%M UTC'),
                'support_url': f'{_site_url()}/pages/auth.html',
            },
            recipient_email=user.email,
        )

    # ── OTP ────────────────────────────────────────────────────────
    def send_otp(self, user, otp, expiry_minutes=10):
        """
        Verification code email.
        Falls back to inline HTML if the template doesn't exist yet.
        """
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
            # Fallback: send a clean plain-text OTP email
            return self._send_otp_fallback(user, otp, expiry_minutes)

    def _send_otp_fallback(self, user, otp, expiry_minutes):
        from django.core.mail import send_mail
        try:
            send_mail(
                subject='Your ARTX verification code',
                message=(
                    f'Hi {user.username},\n\n'
                    f'Your verification code is: {otp}\n\n'
                    f'It expires in {expiry_minutes} minutes.\n\n'
                    f'If you did not request this, ignore this email.\n\n'
                    f'— ARTX Team'
                ),
                from_email=_from(),
                recipient_list=[user.email],
                fail_silently=False,
            )
            return True
        except Exception as exc:
            logger.error('OTP fallback email failed for %s: %s', user.email, exc)
            return False

    # ── Tier upgrade ──────────────────────────────────────────────
    def send_tier_upgrade(self, user, old_tier, new_tier):
        """
        Sent when a user's access tier increases.
        Template: templates/emails/tier_upgrade.html
        """
        return _send(
            subject=f'🏆 You reached {new_tier} Tier on ARTX!',
            template_name='tier_upgrade.html',
            context={
                'user':       user,
                'username':   user.username,
                'old_tier':   old_tier,
                'new_tier':   new_tier,
                'dashboard_url': f'{_site_url()}/pages/user.html',
            },
            recipient_email=user.email,
        )

    # ── Alliance created ──────────────────────────────────────────
    def send_alliance_created(self, user, alliance_name):
        """
        Sent to the creator when their alliance is successfully created.
        Template: templates/emails/alliance_created.html
        """
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

    # ── Alliance joined ───────────────────────────────────────────
    def send_alliance_joined(self, user, alliance_name):
        """
        Sent when a user successfully joins an alliance.
        Template: templates/emails/alliance_join.html
        """
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

    # ── Password reset ────────────────────────────────────────────
    def send_password_reset(self, user, reset_url, expiry_hours=1):
        """
        Sent when a user requests a password reset.
        Template: templates/emails/password_reset.html
        """
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


# Module-level singleton — import this everywhere
email_service = EmailService()
