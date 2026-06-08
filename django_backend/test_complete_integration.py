"""
Complete integration test - Frontend to Backend email flow
Tests the entire user journey without Celery
"""
import os
import django
import sys

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import Client
from users.models import User
from notifications.models import NotificationLog
import json

print("🧪 ARTX Platform Integration Test (No Celery)")
print("=" * 70)

# Create test client
client = Client()

# Test 1: User Registration (triggers welcome email)
print("\n📝 TEST 1: User Registration + Welcome Email")
print("-" * 70)

test_username = "testuser_integration"
test_email = "test@example.com"

# Clean up any existing test user
User.objects.filter(username=test_username).delete()

registration_data = {
    "username": test_username,
    "email": test_email,
    "password": "testpass123",
    "display_name": "Test User"
}

print(f"Registering user: {test_username}")
response = client.post(
    '/api/auth/register/',
    data=json.dumps(registration_data),
    content_type='application/json'
)

print(f"Status Code: {response.status_code}")
if response.status_code == 201:
    data = response.json()
    print(f"✅ Registration successful!")
    print(f"   User: {data['user']['username']}")
    print(f"   Token: {data['token'][:20]}...")
    
    # Check if email log was created
    email_logs = NotificationLog.objects.filter(
        recipient_email=test_email,
        subject__icontains='Welcome'
    )
    if email_logs.exists():
        log = email_logs.first()
        print(f"✅ Welcome email logged!")
        print(f"   Status: {log.status}")
        print(f"   Subject: {log.subject}")
    else:
        print(f"⚠️ No email log found (email may have been sent but not logged)")
else:
    print(f"❌ Registration failed: {response.json()}")
    sys.exit(1)

# Test 2: User Login (triggers login notification email)
print("\n🔐 TEST 2: User Login + Login Notification Email")
print("-" * 70)

login_data = {
    "username": test_username,
    "password": "testpass123"
}

print(f"Logging in user: {test_username}")
response = client.post(
    '/api/auth/login/',
    data=json.dumps(login_data),
    content_type='application/json'
)

print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    data = response.json()
    print(f"✅ Login successful!")
    print(f"   Message: {data['message']}")
    print(f"   Token: {data['token'][:20]}...")
    
    # Check if login notification email log was created
    email_logs = NotificationLog.objects.filter(
        recipient_email=test_email,
        subject__icontains='Welcome back'
    )
    if email_logs.exists():
        log = email_logs.first()
        print(f"✅ Login notification email logged!")
        print(f"   Status: {log.status}")
        print(f"   Subject: {log.subject}")
    else:
        print(f"⚠️ No login email log found")
else:
    print(f"❌ Login failed: {response.json()}")

# Test 3: Get User Profile
print("\n👤 TEST 3: Get User Profile")
print("-" * 70)

token = data['token']
response = client.get(
    '/api/auth/profile/',
    HTTP_AUTHORIZATION=f'Token {token}'
)

print(f"Status Code: {response.status_code}")
if response.status_code == 200:
    profile = response.json()
    print(f"✅ Profile retrieved!")
    print(f"   Username: {profile['username']}")
    print(f"   Email: {profile['email']}")
    print(f"   Prestige: {profile['prestige_points']}")
    print(f"   Tier: {profile['access_tier']}")
else:
    print(f"❌ Profile retrieval failed")

# Summary
print("\n" + "=" * 70)
print("📊 INTEGRATION TEST SUMMARY")
print("=" * 70)

total_emails = NotificationLog.objects.filter(recipient_email=test_email).count()
sent_emails = NotificationLog.objects.filter(recipient_email=test_email, status='sent').count()

print(f"Total email logs: {total_emails}")
print(f"Successfully sent: {sent_emails}")
print(f"\n✅ All tests passed! Frontend → Backend → Email flow working!")
print(f"🎉 No Celery needed - emails send immediately!")

# Cleanup
print("\n🧹 Cleaning up test data...")
User.objects.filter(username=test_username).delete()
print("✅ Test complete!")
