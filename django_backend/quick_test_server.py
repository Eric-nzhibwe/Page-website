#!/usr/bin/env python3
"""
Quick test to check if Django server can handle login requests
"""
import os
import django
from django.test import Client
import json

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from users.models import User

def test_login_endpoint():
    """Test login endpoint using Django test client"""
    print("🔐 TESTING LOGIN WITH DJANGO TEST CLIENT")
    print("=" * 50)
    
    # Create test user
    try:
        # Delete existing test user if exists
        User.objects.filter(username='testuser').delete()
        
        test_user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123',
            display_name='Test User'
        )
        print(f"✅ Created test user: {test_user.username}")
        
        # Test login with Django test client
        client = Client()
        
        # Test 1: Valid login with username
        print("\n🧪 Test 1: Login with username")
        login_data = {
            'username': 'testuser',
            'password': 'testpass123'
        }
        
        response = client.post(
            '/api/auth/login/',
            data=json.dumps(login_data),
            content_type='application/json'
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.content.decode()}")
        
        if response.status_code == 200:
            print("✅ Login successful!")
        else:
            print("❌ Login failed!")
            
        # Test 2: Valid login with email
        print("\n🧪 Test 2: Login with email")
        login_data = {
            'username': 'test@example.com',  # Email in username field
            'password': 'testpass123'
        }
        
        response = client.post(
            '/api/auth/login/',
            data=json.dumps(login_data),
            content_type='application/json'
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.content.decode()}")
        
        if response.status_code == 200:
            print("✅ Email login successful!")
        else:
            print("❌ Email login failed!")
            
        # Test 3: Invalid credentials
        print("\n🧪 Test 3: Invalid credentials")
        login_data = {
            'username': 'testuser',
            'password': 'wrongpassword'
        }
        
        response = client.post(
            '/api/auth/login/',
            data=json.dumps(login_data),
            content_type='application/json'
        )
        
        print(f"Status: {response.status_code}")
        print(f"Response: {response.content.decode()}")
        
        if response.status_code == 400:
            print("✅ Invalid credentials properly rejected!")
        else:
            print("❌ Unexpected response for invalid credentials!")
            
        # Cleanup
        test_user.delete()
        print(f"\n🧹 Cleaned up test user")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_login_endpoint()