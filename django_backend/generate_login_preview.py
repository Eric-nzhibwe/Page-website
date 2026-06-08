#!/usr/bin/env python3
"""
Generate login notification email preview
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.template.loader import render_to_string
from django.utils import timezone
from users.models import User

def generate_login_preview():
    """Generate login notification email preview"""
    
    # Create test user data
    test_user_data = {
        'id': 1,
        'username': 'testuser',
        'display_name': 'Elite Gamer',
        'email': 'test@example.com',
        'prestige_points': 2500,
        'level': 25,
        'access_tier': 'Gold',
        'power_rank': 'Expert',
        'tournament_wins': 12,
        'total_submissions': 150,
        'successful_submissions': 120
    }
    
    # Create a mock user object
    class MockUser:
        def __init__(self, data):
            for key, value in data.items():
                setattr(self, key, value)
    
    test_user = MockUser(test_user_data)
    
    # Context for the email
    context = {
        'user': test_user,
        'login_time': timezone.now(),
        'device_info': 'Chrome on Windows 11',
        'location_info': 'New York, USA',
        'active_tournaments_count': 5,
        'unread_notifications_count': 3
    }
    
    try:
        html_content = render_to_string('emails/login_notification.html', context)
        
        # Save preview to file
        with open('login_notification_preview.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        
        print("✅ Login notification email preview generated!")
        print("📧 Preview saved to: login_notification_preview.html")
        print(f"👤 Test user: {test_user.display_name}")
        print(f"🔐 Login time: {context['login_time'].strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"💻 Device: {context['device_info']}")
        print(f"📍 Location: {context['location_info']}")
        
    except Exception as e:
        print(f"❌ Error generating preview: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    generate_login_preview()