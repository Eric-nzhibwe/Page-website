"""
Email notification functions — all sends run in background threads so they
never block an HTTP request (prevents login/register timeouts on Render).
"""
import threading
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.conf import settings
from django.utils import timezone
from .models import NotificationLog, EmailTemplate


def _bg(fn, *args, **kwargs):
    """Run fn(*args, **kwargs) in a daemon thread."""
    threading.Thread(target=fn, args=args, kwargs=kwargs, daemon=True).start()


# ─────────────────────────────────────────────────────────────────────────────
# Welcome email
# ─────────────────────────────────────────────────────────────────────────────

def _do_send_welcome_email(user_id):
    from users.models import User
    try:
        user = User.objects.get(id=user_id)
        html_content = render_to_string('emails/welcome.html', {'user': user})
        subject = f"Welcome to ARTX Platform, {user.display_name or user.username}! 🎮"
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message="Welcome to ARTX Platform! Your gaming journey starts now.",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
        print(f"✅ Welcome email sent to {user.email}")
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send welcome email: {e}")


def send_welcome_email(user_id):
    """Send welcome email in background — never blocks the request."""
    _bg(_do_send_welcome_email, user_id)


# ─────────────────────────────────────────────────────────────────────────────
# Login notification email
# ─────────────────────────────────────────────────────────────────────────────

def _do_send_login_notification_email(user_id, login_data=None):
    from users.models import User
    try:
        user = User.objects.get(id=user_id)
        context = {
            'user': user,
            'login_time': timezone.now(),
            'device_info':                login_data.get('device_info', 'Unknown device') if login_data else 'Unknown device',
            'location_info':              login_data.get('location_info', 'Secure connection') if login_data else 'Secure connection',
            'active_tournaments_count':   login_data.get('active_tournaments_count', 'Several') if login_data else 'Several',
            'unread_notifications_count': login_data.get('unread_notifications_count', 'Check') if login_data else 'Check',
        }
        html_content = render_to_string('emails/login_notification.html', context)
        subject = f"Welcome back, {user.display_name or user.username}! 🎮"
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message="Welcome back to ARTX Platform! The arena awaits your return.",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
        print(f"✅ Login notification email sent to {user.email}")
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send login notification email: {e}")


def send_login_notification_email(user_id, login_data=None):
    """Send login notification email in background — never blocks the request."""
    _bg(_do_send_login_notification_email, user_id, login_data)


# ─────────────────────────────────────────────────────────────────────────────
# Tier upgrade email
# ─────────────────────────────────────────────────────────────────────────────

def _do_send_tier_upgrade_email(user_id, old_tier, new_tier):
    from users.models import User
    try:
        user = User.objects.get(id=user_id)
        html_content = render_to_string('emails/tier_upgrade.html', {
            'user': user, 'old_tier': old_tier, 'new_tier': new_tier
        })
        subject = f"🏆 TIER UPGRADE! You've Reached {new_tier}! 🚀"
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message=f"Congratulations! You've upgraded from {old_tier} to {new_tier}!",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send tier upgrade email: {e}")


def send_tier_upgrade_email(user_id, old_tier, new_tier):
    """Send tier upgrade email in background."""
    _bg(_do_send_tier_upgrade_email, user_id, old_tier, new_tier)


# ─────────────────────────────────────────────────────────────────────────────
# Alliance emails
# ─────────────────────────────────────────────────────────────────────────────

def _do_send_alliance_join_email(user_id, alliance_id):
    from users.models import User
    from alliances.models import Alliance
    try:
        user = User.objects.get(id=user_id)
        alliance = Alliance.objects.get(id=alliance_id)
        html_content = render_to_string('emails/alliance_join.html', {
            'user': user, 'alliance': alliance
        })
        subject = f"🤝 Welcome to {alliance.name}! Alliance Activated! 🛡️"
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message=f"Welcome to {alliance.name}! Your alliance journey begins now.",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send alliance join email: {e}")


def send_alliance_join_email(user_id, alliance_id):
    """Send alliance join email in background."""
    _bg(_do_send_alliance_join_email, user_id, alliance_id)


def _do_send_alliance_created_email(user_id, alliance_id):
    from users.models import User
    from alliances.models import Alliance
    try:
        user = User.objects.get(id=user_id)
        alliance = Alliance.objects.get(id=alliance_id)
        html_content = render_to_string('emails/alliance_created.html', {
            'user': user, 'alliance': alliance
        })
        subject = "👑 Alliance Created! You're Now a Leader! 🛡️"
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message=f"Congratulations! You've created {alliance.name} alliance.",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send alliance created email: {e}")


def send_alliance_created_email(user_id, alliance_id):
    """Send alliance created email in background."""
    _bg(_do_send_alliance_created_email, user_id, alliance_id)


# ─────────────────────────────────────────────────────────────────────────────
# Tournament reminder email
# ─────────────────────────────────────────────────────────────────────────────

def _do_send_tournament_reminder_email(user_id, tournament_id):
    from users.models import User
    from tournaments.models import Tournament
    try:
        user = User.objects.get(id=user_id)
        tournament = Tournament.objects.get(id=tournament_id)
        subject = f"🏆 Tournament Starting Soon: {tournament.title}"
        html_content = f"""
        <h2>Get Ready, {user.display_name or user.username}!</h2>
        <p>Your tournament <strong>{tournament.title}</strong> is starting soon! 🏆</p>
        <h3>Tournament Details:</h3>
        <ul>
            <li>🎯 Difficulty: {tournament.difficulty.title()}</li>
            <li>⏰ Start Time: {tournament.start_time.strftime('%Y-%m-%d %H:%M UTC')}</li>
            <li>💰 Prize Pool: ${tournament.prize_pool}</li>
            <li>👥 Participants: {tournament.participant_count}/{tournament.max_participants}</li>
        </ul>
        <h3>Prize Distribution:</h3>
        <ul>
            <li>🥇 1st Place: ${tournament.prize_pool * tournament.first_place_percentage / 100}</li>
            <li>🥈 2nd Place: ${tournament.prize_pool * tournament.second_place_percentage / 100}</li>
            <li>🥉 3rd Place: ${tournament.prize_pool * tournament.third_place_percentage / 100}</li>
        </ul>
        <p>May the best gamer win! Good luck! 🍀</p>
        """
        log = NotificationLog.objects.create(
            user=user, subject=subject,
            recipient_email=user.email, status='pending'
        )
        send_mail(
            subject=subject,
            message="",
            html_message=html_content,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
            fail_silently=False,
        )
        log.status = 'sent'
        log.sent_at = timezone.now()
        log.save()
    except Exception as e:
        if 'log' in locals():
            log.status = 'failed'
            log.error_message = str(e)
            log.save()
        print(f"❌ Failed to send tournament reminder: {e}")


def send_tournament_reminder_email(user_id, tournament_id):
    """Send tournament reminder email in background."""
    _bg(_do_send_tournament_reminder_email, user_id, tournament_id)
