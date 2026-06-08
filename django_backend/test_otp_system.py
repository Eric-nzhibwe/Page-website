"""
Quick test script for OTP system
Run: python test_otp_system.py
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from users.otp_service import otp_service
from users.models import User

def test_otp_system():
    print("🧪 Testing OTP System...\n")
    
    # Test 1: OTP Generation
    print("1️⃣ Testing OTP Generation...")
    otp = otp_service.generate_otp()
    print(f"   ✅ Generated OTP: {otp}")
    print(f"   ✅ Length: {len(otp)} digits")
    assert len(otp) == 6, "OTP should be 6 digits"
    assert otp.isdigit(), "OTP should only contain digits"
    print()
    
    # Test 2: Session ID Generation
    print("2️⃣ Testing Session ID Generation...")
    session_id = otp_service.generate_session_id()
    print(f"   ✅ Generated Session ID: {session_id}")
    print(f"   ✅ Length: {len(session_id)} characters")
    assert len(session_id) == 32, "Session ID should be 32 characters"
    print()
    
    # Test 3: Create OTP for User
    print("3️⃣ Testing OTP Creation...")
    try:
        # Get first user or create test user
        user = User.objects.first()
        if not user:
            print("   ⚠️  No users found. Creating test user...")
            user = User.objects.create_user(
                username='test_otp_user',
                email='test@example.com',
                password='testpass123'
            )
            print(f"   ✅ Created test user: {user.username}")
        
        otp, session_id = otp_service.create_otp(user)
        print(f"   ✅ Created OTP for user: {user.username}")
        print(f"   ✅ OTP: {otp}")
        print(f"   ✅ Session ID: {session_id}")
        print()
        
        # Test 4: Verify OTP
        print("4️⃣ Testing OTP Verification...")
        
        # Test with correct OTP
        success, message, user_id = otp_service.verify_otp(session_id, otp)
        print(f"   ✅ Correct OTP: {success} - {message}")
        assert success, "Correct OTP should verify successfully"
        assert user_id == user.id, "Should return correct user ID"
        print()
        
        # Test 5: Verify with wrong OTP
        print("5️⃣ Testing Wrong OTP...")
        otp2, session_id2 = otp_service.create_otp(user)
        success, message, user_id = otp_service.verify_otp(session_id2, "000000")
        print(f"   ✅ Wrong OTP: {success} - {message}")
        assert not success, "Wrong OTP should fail"
        print()
        
        # Test 6: Resend Cooldown
        print("6️⃣ Testing Resend Cooldown...")
        can_resend, message = otp_service.can_resend(session_id2)
        print(f"   ✅ Can resend: {can_resend} - {message}")
        
        otp_service.mark_resent(session_id2)
        can_resend, message = otp_service.can_resend(session_id2)
        print(f"   ✅ After marking resent: {can_resend} - {message}")
        assert not can_resend, "Should not allow immediate resend"
        print()
        
        print("✅ All tests passed! OTP system is working correctly! 🎉")
        
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_otp_system()
