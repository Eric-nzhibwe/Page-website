#!/usr/bin/env python3
"""
Test index.html direct access
"""
import os
import django
from django.test import Client

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

def test_index_html():
    """Test direct access to index.html"""
    client = Client()
    
    print("🧪 TESTING INDEX.HTML DIRECT ACCESS")
    print("=" * 40)
    
    test_cases = [
        ('/', 'Root path'),
        ('/index.html', 'Direct index.html'),
    ]
    
    for url, description in test_cases:
        try:
            print(f"\n🔗 Testing {description}: {url}")
            response = client.get(url)
            
            if response.status_code == 200:
                content_type = response.get('Content-Type', 'Unknown')
                content_length = len(response.content)
                print(f"✅ SUCCESS: {response.status_code}")
                print(f"   Content-Type: {content_type}")
                print(f"   Content-Length: {content_length} bytes")
            else:
                print(f"❌ FAILED: {response.status_code}")
                if hasattr(response, 'content'):
                    print(f"   Response: {response.content[:200]}...")
                    
        except Exception as e:
            print(f"❌ ERROR: {e}")
    
    print("\n🎉 Index.html test complete!")

if __name__ == '__main__':
    test_index_html()