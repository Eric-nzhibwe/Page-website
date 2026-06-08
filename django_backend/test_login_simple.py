#!/usr/bin/env python3
"""
Simple login test
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.test import Client
from users.models import User
import json

def test_login():
    """Simple login test"""
    print("🔐 SIMPLE LOGIN TEST")
    print("=" * 30)
    
    # Create test user
    User.objects.filter(username='testuser').delete()
    test_user = User.objects.create_user(
        username='testuser',
        email='test@example.com',
        password='testpass123'
    )
    print(f"✅ Created user: {test_user.username} ({test_user.email})")
    
    # Test login
    client = Client()
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
    if response.status_code == 200:
        print("✅ LOGIN SUCCESS!")
        data = response.json()
        print(f"Token: {data.get('token', 'No token')[:20]}...")
    else:
        print(f"❌ Login failed: {response.content}")
    
    # Cleanup
    test_user.delete()

if __name__ == '__main__':
    test_login()