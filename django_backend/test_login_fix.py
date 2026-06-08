#!/usr/bin/env python3
"""
Test login fix for username/email mismatch
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import Client
from users.models import User
import json

def test_login_fix():
    """Test the login fix"""
    print("🔐 TESTING LOGIN FIX")
    print("=" * 50)
    
    # Create test user
    test_user = User.objects.create_user(
        username='testuser',
        email='test@example.com',
        password='testpass123',
        display_name='Test User'
    )
    
    print(f"✅ Created test user: {test_user.username} ({test_user.email})")
    
    client = Client()
    
    # Test 1: Login with username
    print("\n🧪 Test 1: Login with username")
    login_data = {
        'username': 'testuser',
        'password': 'testpass123'
    }
    
    response = client.post('/api/auth/login/', 
                         data=json.dumps(login_data),
                         content_type='application/json')
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Username login successful!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
        print(f"Message: {data.get('message', 'No message')}")
    else:
        print(f"❌ Username login failed: {response.content}")
    
    # Test 2: Login with email
    print("\n🧪 Test 2: Login with email")
    login_data = {
        'username': 'test@example.com',  # Using email in username field
        'password': 'testpass123'
    }
    
    response = client.post('/api/auth/login/', 
                         data=json.dumps(login_data),
                         content_type='application/json')
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Email login successful!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
        print(f"Message: {data.get('message', 'No message')}")
    else:
        print(f"❌ Email login failed: {response.content}")
    
    # Test 3: Invalid credentials
    print("\n🧪 Test 3: Invalid credentials")
    login_data = {
        'username': 'testuser',
        'password': 'wrongpassword'
    }
    
    response = client.post('/api/auth/login/', 
                         data=json.dumps(login_data),
                         content_type='application/json')
    
    print(f"Status: {response.status_code}")
    if response.status_code == 400:
        print("✅ Invalid credentials properly rejected!")
        print(f"Error: {response.json()}")
    else:
        print(f"❌ Unexpected response: {response.content}")
    
    # Cleanup
    test_user.delete()
    print(f"\n🧹 Cleaned up test user")
    print("✅ Login fix test completed!")

if __name__ == '__main__':
    test_login_fix()