#!/usr/bin/env python3
"""
Create sample users for ARTX Platform
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from users.models import User

def create_sample_users():
    """Create sample users"""
    users_data = [
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
    for user_data in users_data:
        email = user_data['email']
        if not User.objects.filter(email=email).exists():
            password = 'password123'
            user = User.objects.create_user(password=password, **user_data)
            user.update_level()
            user.update_access_tier()
            user.update_power_rank()
            user.save()
            
            print(f"✅ Created user: {user.username} ({user.email})")
            created_count += 1
        else:
            print(f"⚠️  User {user_data['username']} already exists")
    
    print(f"\n👥 Created {created_count} new sample users")
    print(f"📊 Total users in database: {User.objects.count()}")

if __name__ == '__main__':
    create_sample_users()