#!/usr/bin/env python3
"""
Test login notification email functionality
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.urls import reverse
from notifications.tasks import send_login_notification_email
from notifications.models import NotificationLog
import json

User = get_user_model()

def test_login_notification():
    """Test login notification email functionality"""
    print("🔐 TESTING LOGIN NOTIFICATION EMAIL")
    print("=" * 50)
    
    # Create test user
    test_user = User.objects.create_user(
        username='testuser',
        email='test@example.com',
        password='testpass123',
        display_name='Elite Gamer'
    )
    
    print(f"✅ Created test user: {test_user.display_name}")
    
    # Test the login notification task directly
    try:
        login_data = {
            'device_info': 'Chrome on Windows 11',
            'location_info': 'New York, USA',
            'active_tournaments_count': 5,
            'unread_notifications_count': 3
        }
        
        # Call the task directly (synchronously for testing)
        result = send_login_notification_email.apply(args=[test_user.id, login_data])
        print(f"✅ Login notification task result: {result.result}")
        
        # Check if notification log was created
        log_count = NotificationLog.objects.filter(user=test_user).count()
        print(f"📧 Notification logs created: {log_count}")
        
        if log_count > 0:
            latest_log = NotificationLog.objects.filter(user=test_user).latest('created_at')
            print(f"📧 Latest log status: {latest_log.status}")
            print(f"📧 Latest log subject: {latest_log.subject}")
        
    except Exception as e:
        print(f"❌ Error testing login notification: {str(e)}")
        import traceback
        traceback.print_exc()
    
    # Test the login API endpoint
    print("\n🌐 TESTING LOGIN API ENDPOINT")
    print("=" * 30)
    
    try:
        client = Client()
        
        # Attempt login
        login_data = {
            'username': 'testuser',
            'password': 'testpass123'
        }
        
        response = client.post('/api/users/login/', 
                             data=json.dumps(login_data),
                             content_type='application/json')
        
        print(f"📡 Login API response status: {response.status_code}")
        
        if response.status_code == 200:
            response_data = response.json()
            print(f"✅ Login successful!")
            print(f"👤 User: {response_data.get('user', {}).get('display_name', 'Unknown')}")
            print(f"💬 Message: {response_data.get('message', 'No message')}")
            
            # Check if additional notification logs were created
            new_log_count = NotificationLog.objects.filter(user=test_user).count()
            print(f"📧 Total notification logs: {new_log_count}")
        else:
            print(f"❌ Login failed: {response.content}")
            
    except Exception as e:
        print(f"❌ Error testing login API: {str(e)}")
    
    # Cleanup
    print(f"\n🧹 Cleaning up test user...")
    test_user.delete()
    print("✅ Test completed!")

if __name__ == '__main__':
    test_login_notification()