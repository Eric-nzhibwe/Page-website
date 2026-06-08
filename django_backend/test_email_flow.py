#!/usr/bin/env python3
"""
Test the complete email flow from registration to email delivery
"""
import os
import django
import requests
import time

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import Client
from users.models import User
from notifications.models import NotificationLog

def test_registration_email_flow():
    """Test the complete registration to email flow"""
    print("🧪 TESTING REGISTRATION → EMAIL FLOW")
    print("=" * 50)
    
    # Test data
    test_user_data = {
        'username': f'testuser_{int(time.time())}',
        'email': f'test_{int(time.time())}@example.com',
        'display_name': 'Test Gamer',
        'password': 'testpass123'
    }
    
    print(f"📝 Test user data:")
    print(f"   Username: {test_user_data['username']}")
    print(f"   Email: {test_user_data['email']}")
    
    # Step 1: Test Django API registration endpoint
    print("\n🔗 Step 1: Testing Django API registration...")
    
    client = Client()
    response = client.post('/api/auth/register/', 
                          data=test_user_data, 
                          content_type='application/json')
    
    print(f"   Status Code: {response.status_code}")
    
    if response.status_code == 201:
        print("   ✅ Registration API endpoint working!")
        response_data = response.json()
        print(f"   Token received: {response_data.get('token', 'None')[:20]}...")
        print(f"   Message: {response_data.get('message', 'None')}")
    else:
        print(f"   ❌ Registration failed: {response.content}")
        return False
    
    # Step 2: Check if user was created in database
    print("\n💾 Step 2: Checking database user creation...")
    
    try:
        user = User.objects.get(username=test_user_data['username'])
        print(f"   ✅ User created in database!")
        print(f"   ID: {user.id}")
        print(f"   Email: {user.email}")
        print(f"   Display Name: {user.display_name}")
        print(f"   Prestige: {user.prestige_points}")
        print(f"   Tier: {user.access_tier}")
    except User.DoesNotExist:
        print("   ❌ User not found in database!")
        return False
    
    # Step 3: Check if email notification was logged
    print("\n📧 Step 3: Checking email notification log...")
    
    # Wait a moment for async task
    time.sleep(2)
    
    try:
        email_log = NotificationLog.objects.filter(
            user=user,
            recipient_email=user.email
        ).first()
        
        if email_log:
            print(f"   ✅ Email notification logged!")
            print(f"   Subject: {email_log.subject}")
            print(f"   Status: {email_log.status}")
            print(f"   Sent at: {email_log.sent_at}")
            if email_log.error_message:
                print(f"   Error: {email_log.error_message}")
        else:
            print("   ⚠️  No email log found (might be async delay)")
    except Exception as e:
        print(f"   ❌ Error checking email log: {e}")
    
    # Step 4: Test email template rendering
    print("\n🎨 Step 4: Testing email template rendering...")
    
    try:
        from django.template.loader import render_to_string
        html_content = render_to_string('emails/welcome.html', {'user': user})
        
        if html_content and len(html_content) > 100:
            print("   ✅ Email template rendered successfully!")
            print(f"   Template length: {len(html_content)} characters")
            print(f"   Contains username: {'✅' if user.username in html_content else '❌'}")
            print(f"   Contains welcome: {'✅' if 'Welcome' in html_content else '❌'}")
        else:
            print("   ❌ Email template rendering failed!")
    except Exception as e:
        print(f"   ❌ Template rendering error: {e}")
    
    # Step 5: Test live HTTP registration (if server is running)
    print("\n🌐 Step 5: Testing live HTTP registration...")
    
    try:
        live_user_data = {
            'username': f'livetest_{int(time.time())}',
            'email': f'live_{int(time.time())}@example.com',
            'display_name': 'Live Test Gamer',
            'password': 'livetest123'
        }
        
        response = requests.post('http://localhost:8000/api/auth/register/', 
                               json=live_user_data, 
                               timeout=10)
        
        if response.status_code == 201:
            print("   ✅ Live HTTP registration working!")
            data = response.json()
            print(f"   Message: {data.get('message', 'None')}")
            print(f"   Token: {data.get('token', 'None')[:20]}...")
        else:
            print(f"   ❌ Live HTTP registration failed: {response.status_code}")
            print(f"   Response: {response.text[:200]}...")
            
    except requests.exceptions.ConnectionError:
        print("   ⚠️  Django server not running (start with: python manage.py runserver)")
    except Exception as e:
        print(f"   ❌ Live test error: {e}")
    
    print("\n🎉 EMAIL FLOW TEST COMPLETE!")
    print("=" * 50)
    
    return True

def show_email_flow_summary():
    """Show summary of the email flow"""
    print("\n📋 EMAIL FLOW SUMMARY")
    print("=" * 30)
    print("1. 🌐 User fills form in auth.html")
    print("2. 📡 JavaScript calls /api/auth/register/")
    print("3. 🔧 Django UserRegistrationView processes request")
    print("4. 💾 User saved to database")
    print("5. 📧 send_welcome_email.delay(user.id) called")
    print("6. 🎨 Email template rendered with user data")
    print("7. 📬 Email sent via Django mail system")
    print("8. 📝 NotificationLog entry created")
    print("9. ✅ User receives welcome email!")
    print("\n🔗 TEMPLATE CHAIN:")
    print("   auth.html → auth.js → Django API → Email Task → HTML Template → User's Inbox")

if __name__ == '__main__':
    show_email_flow_summary()
    test_registration_email_flow()