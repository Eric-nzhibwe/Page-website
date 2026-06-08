"""
Test script for messenger functionality
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from users.models import User
from messenger.models import Conversation, Message

print("🧪 Testing ARTX Messenger")
print("=" * 70)

# Get or create test users
print("\n1️⃣ Creating test users...")
user1, created1 = User.objects.get_or_create(
    username='testuser1',
    defaults={
        'email': 'user1@test.com',
        'display_name': 'Test User 1'
    }
)
if created1:
    user1.set_password('password123')
    user1.save()
    print(f"✅ Created {user1.username}")
else:
    print(f"📌 Using existing {user1.username}")

user2, created2 = User.objects.get_or_create(
    username='testuser2',
    defaults={
        'email': 'user2@test.com',
        'display_name': 'Test User 2'
    }
)
if created2:
    user2.set_password('password123')
    user2.save()
    print(f"✅ Created {user2.username}")
else:
    print(f"📌 Using existing {user2.username}")

# Create conversation
print("\n2️⃣ Creating conversation...")
conversation = Conversation.objects.filter(
    participants=user1
).filter(
    participants=user2
).first()

if not conversation:
    conversation = Conversation.objects.create()
    conversation.participants.add(user1, user2)
    print(f"✅ Created conversation {conversation.id}")
else:
    print(f"📌 Using existing conversation {conversation.id}")

# Send messages
print("\n3️⃣ Sending test messages...")

# Message from user1
msg1 = Message.objects.create(
    conversation=conversation,
    sender=user1,
    message_type='text',
    text='Hey! How are you doing?'
)
print(f"✅ {user1.username}: {msg1.text}")

# Message from user2
msg2 = Message.objects.create(
    conversation=conversation,
    sender=user2,
    message_type='text',
    text='I\'m great! Just testing the messenger.'
)
print(f"✅ {user2.username}: {msg2.text}")

# Message from user1
msg3 = Message.objects.create(
    conversation=conversation,
    sender=user1,
    message_type='text',
    text='Awesome! The backend integration is working perfectly!'
)
print(f"✅ {user1.username}: {msg3.text}")

# Check conversation
print("\n4️⃣ Verifying conversation...")
print(f"📊 Conversation ID: {conversation.id}")
print(f"👥 Participants: {', '.join([u.username for u in conversation.participants.all()])}")
print(f"💬 Total messages: {conversation.messages.count()}")
print(f"📅 Last updated: {conversation.updated_at}")

# Check last message
last_msg = conversation.get_last_message()
if last_msg:
    print(f"📝 Last message: {last_msg.sender.username}: {last_msg.text}")

# Check unread count
unread_for_user2 = conversation.messages.filter(read=False).exclude(sender=user2).count()
print(f"🔔 Unread for {user2.username}: {unread_for_user2}")

print("\n" + "=" * 70)
print("✅ Messenger test complete!")
print("\n📝 Test credentials:")
print(f"   User 1: {user1.username} / password123")
print(f"   User 2: {user2.username} / password123")
print("\n🚀 You can now:")
print("   1. Start Django server: python manage.py runserver")
print("   2. Login as testuser1")
print("   3. Open messenger and chat with testuser2")
print("   4. Login as testuser2 (different browser) to see messages")
