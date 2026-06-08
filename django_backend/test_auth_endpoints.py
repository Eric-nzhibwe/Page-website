#!/usr/bin/env python3
"""
Test authentication endpoints with frontend-like requests
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import Client
from users.models import User
import json

def test_auth_endpoints():
    """Test registration and login like the frontend does"""
    print("🔐 TESTING AUTH ENDPOINTS (Frontend-like)")
    print("=" * 50)
    
    # Clean up any existing test user
    User.objects.filter(username='testuser123').delete()
    User.objects.filter(email='test123@example.com').delete()
    
    client = Client()
    
    # Test 1: Registration (exactly like frontend)
    print("\n📝 Test 1: Registration")
    register_data = {
        'username': 'testuser123',
        'email': 'test123@example.com',
        'display_name': 'testuser123',
        'password': 'testpass123'
        # Note: NO password_confirm field, just like frontend
    }
    
    response = client.post(
        '/api/auth/register/',
        data=json.dumps(register_data),
        content_type='application/json'
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 201:
        print("✅ Registration successful!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
        print(f"Message: {data.get('message')}")
        token = data.get('token')
    else:
        print(f"❌ Registration failed!")
        print(f"Response: {response.content.decode()}")
        return
    
    # Test 2: Login (exactly like frontend)
    print("\n🔐 Test 2: Login")
    login_data = {
        'username': 'testuser123',
        'password': 'testpass123'
    }
    
    response = client.post(
        '/api/auth/login/',
        data=json.dumps(login_data),
        content_type='application/json'
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Login successful!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
        print(f"Message: {data.get('message')}")
    else:
        print(f"❌ Login failed!")
        print(f"Response: {response.content.decode()}")
    
    # Test 3: Login with email
    print("\n🔐 Test 3: Login with email")
    login_data = {
        'username': 'test123@example.com',  # Using email
        'password': 'testpass123'
    }
    
    response = client.post(
        '/api/auth/login/',
        data=json.dumps(login_data),
        content_type='application/json'
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✅ Email login successful!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
    else:
        print(f"❌ Email login failed!")
        print(f"Response: {response.content.decode()}")
    
    # Cleanup
    User.objects.filter(username='testuser123').delete()
    print(f"\n🧹 Cleaned up test user")
    print("✅ All tests completed!")

if __name__ == '__main__':
    test_auth_endpoints()