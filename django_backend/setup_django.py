#!/usr/bin/env python3
"""
Django ARTX Platform Setup Script
=================================

Quick setup script to get your Django backend running.

Usage:
    python setup_django.py
"""

import os
import sys
import subprocess
import django
from django.core.management import execute_from_command_line

def run_command(command, description):
    """Run a command and show progress"""
    print(f"🚀 {description}...")
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ {description} completed!")
            if result.stdout:
                print(f"   Output: {result.stdout.strip()}")
        else:
            print(f"❌ {description} failed!")
            if result.stderr:
                print(f"   Error: {result.stderr.strip()}")
        return result.returncode == 0
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return False

def setup_environment():
    """Setup environment variables"""
    print("🔧 Setting up environment...")
    
    if not os.path.exists('.env'):
        if os.path.exists('.env.example'):
            import shutil
            shutil.copy('.env.example', '.env')
            print("✅ Created .env file from .env.example")
            print("💡 Please edit .env file with your actual settings")
        else:
            print("⚠️  No .env.example found, creating basic .env")
            with open('.env', 'w') as f:
                f.write("SECRET_KEY=django-insecure-change-me-in-production\n")
                f.write("DEBUG=True\n")
                f.write("ALLOWED_HOSTS=localhost,127.0.0.1\n")
    else:
        print("✅ .env file already exists")

def setup_database():
    """Setup database"""
    print("🗄️ Setting up database...")
    
    # Set Django settings
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
    django.setup()
    
    # Make migrations
    print("📝 Creating migrations...")
    execute_from_command_line(['manage.py', 'makemigrations'])
    
    # Run migrations
    print("🔄 Running migrations...")
    execute_from_command_line(['manage.py', 'migrate'])
    
    print("✅ Database setup completed!")

def create_sample_data():
    """Create sample data"""
    print("👥 Creating sample data...")
    
    from django.contrib.auth import get_user_model
    from users.models import UserActivity
    
    User = get_user_model()
    
    # Create sample users
    sample_users = [
        {
            'username': 'admin',
            'email': 'admin@artx.com',
            'display_name': 'ARTX Admin',
            'prestige_points': 10000,
            'is_staff': True,
            'is_superuser': True
        },
        {
            'username': 'elitewarrior',
            'email': 'elite@example.com',
            'display_name': 'Elite Warrior',
            'prestige_points': 5000,
            'tournament_wins': 15
        },
        {
            'username': 'progamer',
            'email': 'pro@example.com',
            'display_name': 'Pro Gamer',
            'prestige_points': 3500,
            'tournament_wins': 8
        },
        {
            'username': 'skillmaster',
            'email': 'skill@example.com',
            'display_name': 'Skill Master',
            'prestige_points': 2450,
            'tournament_wins': 5
        }
    ]
    
    created_count = 0
    for user_data in sample_users:
        email = user_data['email']
        if not User.objects.filter(email=email).exists():
            password = user_data.pop('password', 'password123')
            user = User.objects.create_user(password=password, **user_data)
            user.update_level()
            user.update_access_tier()
            user.update_power_rank()
            user.save()
            
            print(f"✅ Created user: {user.username} ({user.email})")
            created_count += 1
        else:
            print(f"⚠️  User {user_data['username']} already exists")
    
    print(f"👥 Created {created_count} sample users")

def show_next_steps():
    """Show next steps"""
    print("\n🎉 Django ARTX Platform Setup Complete!")
    print("=" * 50)
    print()
    print("🚀 Next Steps:")
    print("1. Start the development server:")
    print("   python manage.py runserver")
    print()
    print("2. Access the application:")
    print("   🌐 Main site: http://localhost:8000")
    print("   🔧 Admin panel: http://localhost:8000/admin")
    print("   📊 API docs: http://localhost:8000/api")
    print()
    print("3. Test the API:")
    print("   📝 Register: POST /api/auth/register/")
    print("   🔐 Login: POST /api/auth/login/")
    print("   👤 Profile: GET /api/auth/profile/")
    print()
    print("4. Sample Users Created:")
    print("   👑 admin@artx.com (password: password123)")
    print("   ⚔️  elite@example.com (password: password123)")
    print("   🎮 pro@example.com (password: password123)")
    print("   🏆 skill@example.com (password: password123)")
    print()
    print("🔥 Your Django backend is ready! LET'S GOOO! 🚀")

def main():
    """Main setup function"""
    print("🎮 ARTX Platform Django Setup")
    print("=" * 50)
    
    # Check if we're in the right directory
    if not os.path.exists('manage.py'):
        print("❌ manage.py not found. Please run this script from the django_backend directory.")
        sys.exit(1)
    
    try:
        # Setup steps
        setup_environment()
        setup_database()
        create_sample_data()
        show_next_steps()
        
    except Exception as e:
        print(f"❌ Setup failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()