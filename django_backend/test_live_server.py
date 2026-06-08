#!/usr/bin/env python3
"""
Test live Django server for ARTX Platform
"""
import requests
import time

def test_live_server():
    """Test the live Django server"""
    base_url = "http://127.0.0.1:8000"
    
    print("🧪 TESTING LIVE DJANGO SERVER")
    print("=" * 40)
    
    test_cases = [
        ('/', 'index.html'),
        ('/styles/styles.css', 'CSS file'),
        ('/scripts/app.js', 'JavaScript file'),
        ('/images/ARTX.jpg', 'Image file'),
        ('/favicon.ico', 'Favicon'),
    ]
    
    for endpoint, description in test_cases:
        try:
            print(f"\n🔗 Testing {description}: {endpoint}")
            response = requests.get(f"{base_url}{endpoint}", timeout=5)
            
            if response.status_code == 200:
                content_type = response.headers.get('Content-Type', 'Unknown')
                content_length = len(response.content)
                print(f"✅ SUCCESS: {response.status_code}")
                print(f"   Content-Type: {content_type}")
                print(f"   Content-Length: {content_length} bytes")
            else:
                print(f"❌ FAILED: {response.status_code}")
                print(f"   Response: {response.text[:200]}...")
                    
        except requests.exceptions.RequestException as e:
            print(f"❌ CONNECTION ERROR: {e}")
        except Exception as e:
            print(f"❌ ERROR: {e}")
    
    print("\n🎉 Live server test complete!")

if __name__ == '__main__':
    # Wait a moment for server to be ready
    time.sleep(2)
    test_live_server()