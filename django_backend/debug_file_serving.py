#!/usr/bin/env python3
"""
Debug file serving for ARTX Platform
"""
import os
import sys

# Add the django_backend directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Set Django settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

try:
    import django
    django.setup()
    
    from django.conf import settings
    
    print("🔍 DEBUGGING FILE SERVING")
    print("=" * 50)
    
    # Get project root
    project_root = os.path.dirname(settings.BASE_DIR)
    print(f"📁 Project root: {project_root}")
    
    # Test file paths
    test_files = [
        'styles/styles.css',
        'scripts/app.js',
        'images/ARTX.jpg',
        'Images/ARTX.jpg',  # Case sensitivity test
        'index.html'
    ]
    
    for file_path in test_files:
        full_path = os.path.join(project_root, file_path)
        exists = os.path.exists(full_path)
        is_file = os.path.isfile(full_path) if exists else False
        
        status = "✅" if exists and is_file else "❌"
        print(f"{status} {file_path}")
        print(f"   Full path: {full_path}")
        print(f"   Exists: {exists}, Is file: {is_file}")
        
        if exists and is_file:
            size = os.path.getsize(full_path)
            print(f"   Size: {size} bytes")
        print()
    
    # Test Django URL resolution
    print("🔗 TESTING URL RESOLUTION")
    print("=" * 30)
    
    from django.urls import reverse
    from django.test import Client
    
    client = Client()
    
    test_urls = [
        '/',
        '/styles/styles.css',
        '/scripts/app.js',
        '/images/ARTX.jpg',
        '/Images/ARTX.jpg'
    ]
    
    for url in test_urls:
        try:
            response = client.get(url)
            status = "✅" if response.status_code == 200 else "❌"
            print(f"{status} {url} → {response.status_code}")
            if hasattr(response, 'get'):
                content_type = response.get('Content-Type', 'Not set')
                print(f"   Content-Type: {content_type}")
        except Exception as e:
            print(f"❌ {url} → Error: {e}")
        print()
    
    print("🎉 Debug complete!")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()