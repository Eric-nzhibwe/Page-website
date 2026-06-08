#!/usr/bin/env python3
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.template.loader import render_to_string
from users.models import User
from alliances.models import Alliance

# Get test user
user = User.objects.filter(email='test@example.com').first()
alliance = Alliance.objects.filter(name='Elite Warriors').first()

if user:
    # Welcome email
    html = render_to_string('emails/welcome.html', {'user': user})
    with open('welcome_preview.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print('✅ Welcome email preview created!')
    
    # Tier upgrade email
    html = render_to_string('emails/tier_upgrade.html', {
        'user': user, 'old_tier': 'Silver', 'new_tier': 'Gold'
    })
    with open('tier_upgrade_preview.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print('✅ Tier upgrade email preview created!')
    
    if alliance:
        # Alliance join email
        html = render_to_string('emails/alliance_join.html', {
            'user': user, 'alliance': alliance
        })
        with open('alliance_join_preview.html', 'w', encoding='utf-8') as f:
            f.write(html)
        print('✅ Alliance join email preview created!')
        
        # Alliance creation email
        html = render_to_string('emails/alliance_created.html', {
            'user': user, 'alliance': alliance
        })
        with open('alliance_created_preview.html', 'w', encoding='utf-8') as f:
            f.write(html)
        print('✅ Alliance creation email preview created!')
    
    print('\n🎉 All email previews generated!')
    print('Open the HTML files in your browser to see the templates!')
else:
    print('❌ Test user not found')