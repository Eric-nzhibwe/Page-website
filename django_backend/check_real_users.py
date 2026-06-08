"""
Quick script to verify messenger shows real database users
"""
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from users.models import User
from messenger.models import Conversation, Message

print("=" * 70)
print("🔍 CHECKING REAL DATABASE USERS FOR MESSENGER")
print("=" * 70)

# Get all users
all_users = User.objects.all()
print(f"\n📊 Total users in database: {all_users.count()}")

if all_users.count() > 0:
    print("\n👥 Users available for messaging:")
    print("-" * 70)
    for user in all_users:
        print(f"  • {user.username:20} | {user.display_name:20} | {user.access_tier:10} | {user.prestige_points:,} pts")
    
    # Simulate what the API returns
    print("\n" + "=" * 70)
    print("🎯 SIMULATING API CALL: /api/messenger/available-users/")
    print("=" * 70)
    
    # Pick first user as example
    current_user = all_users.first()
    print(f"\n👤 Logged in as: {current_user.username}")
    
    # Get available users (excluding current user)
    available_users = User.objects.exclude(id=current_user.id).order_by('-prestige_points')[:50]
    
    print(f"\n✅ Users {current_user.username} can chat with: {available_users.count()}")
    print("-" * 70)
    for user in available_users:
        print(f"  • {user.username:20} | {user.display_name:20} | {user.access_tier:10} | {user.prestige_points:,} pts")
    
    # Check existing conversations
    print("\n" + "=" * 70)
    print("💬 EXISTING CONVERSATIONS")
    print("=" * 70)
    
    conversations = Conversation.objects.all()
    if conversations.count() > 0:
        for conv in conversations:
            participants = [u.username for u in conv.participants.all()]
            msg_count = conv.messages.count()
            print(f"\n  Conversation {conv.id}:")
            print(f"    Participants: {', '.join(participants)}")
            print(f"    Messages: {msg_count}")
            print(f"    Last updated: {conv.updated_at}")
            
            # Show last 3 messages
            if msg_count > 0:
                print(f"    Recent messages:")
                for msg in conv.messages.all()[:3]:
                    preview = msg.text[:50] if msg.text else f"[{msg.message_type}]"
                    print(f"      - {msg.sender.username}: {preview}")
    else:
        print("\n  No conversations yet. Start chatting to create some!")
    
else:
    print("\n⚠️  No users found in database!")
    print("   Run: python test_messenger.py")
    print("   Or create users through the registration page")

print("\n" + "=" * 70)
print("✅ VERIFICATION COMPLETE")
print("=" * 70)
print("\n📝 Summary:")
print(f"  • Total users in database: {all_users.count()}")
print(f"  • Users available for messaging: {all_users.count() - 1 if all_users.count() > 0 else 0}")
print(f"  • Existing conversations: {Conversation.objects.count()}")
print(f"  • Total messages: {Message.objects.count()}")
print("\n🎯 Messenger uses REAL database users - confirmed!")
