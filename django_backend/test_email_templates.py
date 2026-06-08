#!/usr/bin/env python3
"""
Test and preview email templates for ARTX Platform
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.template.loader import render_to_string
from users.models import User
from alliances.models import Alliance
from notifications.tasks import (
    send_welcome_email, send_tier_upgrade_email, 
    send_alliance_join_email, send_alliance_created_email,
    send_login_notification_email
)

def create_test_data():
    """Create test data for email templates"""
    # Create test user
    test_user, created = User.objects.get_or_create(
        email='test@example.com',
        defaults={
            'username': 'testuser',
            'display_name': 'Elite Gamer',
            'prestige_points': 2500,
            'level': 25,
            'access_tier': 'Gold',
            'power_rank': 'Expert',
            'tournament_wins': 12,
            'total_submissions': 150,
            'successful_submissions': 120
        }
    )
    
    # Create test alliance
    test_alliance, created = Alliance.objects.get_or_create(
        name='Elite Warriors',
        defaults={
            'tag': 'ELITE',
            'leader': test_user,
            'description': 'The most elite gaming alliance on ARTX - Victory Through Unity',
            'max_members': 50,
            'is_public': True,
            'total_prestige': 15000,
            'tournament_wins': 8,
            'level': 15
        }
    )
    
    return test_user, test_alliance

def preview_welcome_email():
    """Preview welcome email template"""
    print("🎮 WELCOME EMAIL PREVIEW")
    print("=" * 50)
    
    test_user, _ = create_test_data()
    
    try:
        html_content = render_to_string('emails/welcome.html', {'user': test_user})
        
        # Save preview to file
        with open('welcome_email_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Welcome email template rendered successfully!")
        print(f"📧 Preview saved to: welcome_email_preview.html")
        print(f"👤 Test user: {test_user.display_name} ({test_user.email})")
        print(f"📊 Stats: Level {test_user.level}, {test_user.prestige_points} prestige, {test_user.access_tier} tier")
        
    except Exception as e:
        print(f"❌ Error rendering welcome email: {str(e)}")

def preview_tier_upgrade_email():
    """Preview tier upgrade email template"""
    print("\n🚀 TIER UPGRADE EMAIL PREVIEW")
    print("=" * 50)
    
    test_user, _ = create_test_data()
    
    try:
        html_content = render_to_string('emails/tier_upgrade.html', {
            'user': test_user,
            'old_tier': 'Silver',
            'new_tier': 'Gold'
        })
        
        # Save preview to file
        with open('tier_upgrade_email_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Tier upgrade email template rendered successfully!")
        print(f"📧 Preview saved to: tier_upgrade_email_preview.html")
        print(f"📈 Upgrade: Silver → Gold")
        
    except Exception as e:
        print(f"❌ Error rendering tier upgrade email: {str(e)}")

def preview_alliance_join_email():
    """Preview alliance join email template"""
    print("\n🛡️ ALLIANCE JOIN EMAIL PREVIEW")
    print("=" * 50)
    
    test_user, test_alliance = create_test_data()
    
    try:
        html_content = render_to_string('emails/alliance_join.html', {
            'user': test_user,
            'alliance': test_alliance
        })
        
        # Save preview to file
        with open('alliance_join_email_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Alliance join email template rendered successfully!")
        print(f"📧 Preview saved to: alliance_join_email_preview.html")
        print(f"🛡️ Alliance: {test_alliance.name}")
        
    except Exception as e:
        print(f"❌ Error rendering alliance join email: {str(e)}")

def preview_alliance_created_email():
    """Preview alliance creation email template"""
    print("\n👑 ALLIANCE CREATION EMAIL PREVIEW")
    print("=" * 50)
    
    test_user, test_alliance = create_test_data()
    
    try:
        html_content = render_to_string('emails/alliance_created.html', {
            'user': test_user,
            'alliance': test_alliance
        })
        
        # Save preview to file
        with open('alliance_created_email_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Alliance creation email template rendered successfully!")
        print(f"📧 Preview saved to: alliance_created_email_preview.html")
        print(f"👑 Alliance: {test_alliance.name}")
        
    except Exception as e:
        print(f"❌ Error rendering alliance creation email: {str(e)}")

def preview_login_notification_email():
    """Preview login notification email template"""
    print("\n🔐 LOGIN NOTIFICATION EMAIL PREVIEW")
    print("=" * 50)
    
    test_user, _ = create_test_data()
    
    try:
        from django.utils import timezone
        
        context = {
            'user': test_user,
            'login_time': timezone.now(),
            'device_info': 'Chrome on Windows 11',
            'location_info': 'New York, USA',
            'active_tournaments_count': 5,
            'unread_notifications_count': 3
        }
        
        html_content = render_to_string('emails/login_notification.html', context)
        
        # Save preview to file
        with open('login_notification_email_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Login notification email template rendered successfully!")
        print(f"📧 Preview saved to: login_notification_email_preview.html")
        print(f"🔐 Login time: {context['login_time'].strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"💻 Device: {context['device_info']}")
        
    except Exception as e:
        print(f"❌ Error rendering login notification email: {str(e)}")

def test_email_sending():
    """Test actual email sending (requires email configuration)"""
    print("\n📤 EMAIL SENDING TEST")
    print("=" * 50)
    
    test_user, test_alliance = create_test_data()
    
    print("⚠️  This will attempt to send real emails!")
    print(f"📧 Target email: {test_user.email}")
    
    choice = input("Do you want to proceed? (y/N): ").lower().strip()
    
    if choice == 'y':
        try:
            # Test welcome email
            print("📧 Sending welcome email...")
            result = send_welcome_email.apply(args=[test_user.id])
            print(f"✅ Welcome email result: {result.result}")
            
            # Test tier upgrade email
            print("📧 Sending tier upgrade email...")
            result = send_tier_upgrade_email.apply(args=[test_user.id, 'Silver', 'Gold'])
            print(f"✅ Tier upgrade email result: {result.result}")
            
            # Test alliance join email
            print("📧 Sending alliance join email...")
            result = send_alliance_join_email.apply(args=[test_user.id, test_alliance.id])
            print(f"✅ Alliance join email result: {result.result}")
            
            # Test alliance creation email
            print("📧 Sending alliance creation email...")
            result = send_alliance_created_email.apply(args=[test_user.id, test_alliance.id])
            print(f"✅ Alliance creation email result: {result.result}")
            
            # Test login notification email
            print("📧 Sending login notification email...")
            login_data = {
                'device_info': 'Chrome on Windows 11',
                'location_info': 'New York, USA',
                'active_tournaments_count': 5,
                'unread_notifications_count': 3
            }
            result = send_login_notification_email.apply(args=[test_user.id, login_data])
            print(f"✅ Login notification email result: {result.result}")
            
        except Exception as e:
            print(f"❌ Email sending failed: {str(e)}")
            print("💡 Make sure your email configuration is correct in .env file")
    else:
        print("📧 Email sending test skipped")

def main():
    """Main function"""
    print("🎮 ARTX EMAIL TEMPLATE TESTER")
    print("=" * 50)
    
    # Preview all templates
    preview_welcome_email()
    preview_tier_upgrade_email()
    preview_alliance_join_email()
    preview_alliance_created_email()
    preview_login_notification_email()
    
    print("\n🎉 ALL EMAIL TEMPLATES GENERATED!")
    print("=" * 50)
    print("📁 Preview files created:")
    print("   • welcome_email_preview.html")
    print("   • tier_upgrade_email_preview.html")
    print("   • alliance_join_email_preview.html")
    print("   • alliance_created_email_preview.html")
    print("   • login_notification_email_preview.html")
    print("\n💡 Open these files in your browser to see how the emails look!")
    
    # Optional email sending test
    test_email_sending()

if __name__ == '__main__':
    main()