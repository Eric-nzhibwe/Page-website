#!/usr/bin/env python3
"""
Test frontend file serving for ARTX Platform
"""
import os
import django
from django.test import Client
from django.conf import settings

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

def test_frontend_serving():
    """Test that frontend files are served correctly"""
    client = Client()
    
    print("🧪 Testing Frontend File Serving")
    print("=" * 40)
    
    # Test root page (index.html)
    print("📄 Testing root page (/)...")
    response = client.get('/')
    if response.status_code == 200:
        print("✅ Root page loads successfully")
        print(f"   Content-Type: {response.get('Content-Type', 'Not set')}")
        print(f"   Content length: {len(response.content)} bytes")
    else:
        print(f"❌ Root page failed: {response.status_code}")
    
    # Test auth page
    print("\n🔐 Testing auth page...")
    response = client.get('/pages/auth.html')
    if response.status_code == 200:
        print("✅ Auth page loads successfully")
        print(f"   Content-Type: {response.get('Content-Type', 'Not set')}")
    else:
        print(f"❌ Auth page failed: {response.status_code}")
    
    # Test CSS file
    print("\n🎨 Testing CSS file...")
    response = client.get('/styles/styles.css')
    if response.status_code == 200:
        print("✅ CSS file loads successfully")
        print(f"   Content-Type: {response.get('Content-Type', 'Not set')}")
    else:
        print(f"❌ CSS file failed: {response.status_code}")
    
    # Test JavaScript file
    print("\n📜 Testing JavaScript file...")
    response = client.get('/scripts/app.js')
    if response.status_code == 200:
        print("✅ JavaScript file loads successfully")
        print(f"   Content-Type: {response.get('Content-Type', 'Not set')}")
    else:
        print(f"❌ JavaScript file failed: {response.status_code}")
    
    # Test favicon
    print("\n🖼️ Testing favicon...")
    response = client.get('/favicon.ico')
    if response.status_code == 200:
        print("✅ Favicon loads successfully")
        print(f"   Content-Type: {response.get('Content-Type', 'Not set')}")
    else:
        print(f"❌ Favicon failed: {response.status_code}")
    
    # Test API endpoint (should still work)
    print("\n🔌 Testing API endpoint...")
    response = client.get('/api/auth/profile/')
    if response.status_code in [200, 401]:  # 401 is expected without auth
        print("✅ API endpoint accessible")
        print(f"   Status: {response.status_code} (401 expected without auth)")
    else:
        print(f"❌ API endpoint failed: {response.status_code}")
    
    print("\n🎉 Frontend serving test complete!")

if __name__ == '__main__':
    test_frontend_serving()