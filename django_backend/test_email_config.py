#!/usr/bin/env python3
"""
Test email configuration for ARTX Platform
"""
import os
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')
django.setup()

from django.core.mail import send_mail
from django.conf import settings

def test_email_config():
    """Test email configuration"""
    print("🔧 Testing Email Configuration")
    print("=" * 40)
    
    # Check settings
    print(f"📧 Email Backend: {settings.EMAIL_BACKEND}")
    print(f"🌐 Email Host: {settings.EMAIL_HOST}")
    print(f"🔌 Email Port: {settings.EMAIL_PORT}")
    print(f"🔒 Use TLS: {settings.EMAIL_USE_TLS}")
    print(f"👤 Email User: {settings.EMAIL_HOST_USER}")
    print(f"📨 Default From: {settings.DEFAULT_FROM_EMAIL}")
    
    # Check if credentials are configured
    if settings.EMAIL_HOST_USER == 'your-email@gmail.com':
        print("\n⚠️  Email credentials not configured!")
        print("Please update your .env file with:")
        print("EMAIL_HOST_USER=your-actual-email@gmail.com")
        print("EMAIL_HOST_PASSWORD=your-app-password")
        return False
    
    # Test email sending (dry run)
    print(f"\n🔑 Password configured: {'Yes' if settings.EMAIL_HOST_PASSWORD else 'No'}")
    
    if settings.EMAIL_HOST_PASSWORD:
        try:
            # Try to send a test email
            print("\n📤 Attempting to send test email...")
            send_mail(
                subject='ARTX Platform - Email Test',
                message='This is a test email from your ARTX Platform Django backend.',
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[settings.EMAIL_HOST_USER],  # Send to yourself
                fail_silently=False,
            )
            print("✅ Test email sent successfully!")
            return True
        except Exception as e:
            print(f"❌ Email sending failed: {str(e)}")
            print("\n💡 Common issues:")
            print("1. Make sure you're using an App Password, not your regular Gmail password")
            print("2. Enable 2-factor authentication on your Gmail account")
            print("3. Generate an App Password in Gmail settings")
            print("4. Check your internet connection")
            return False
    else:
        print("❌ No email password configured")
        return False

def show_gmail_setup_guide():
    """Show Gmail setup instructions"""
    print("\n📋 Gmail Setup Guide")
    print("=" * 40)
    print("1. Go to your Google Account settings")
    print("2. Enable 2-Factor Authentication")
    print("3. Go to Security > App passwords")
    print("4. Generate a new app password for 'Mail'")
    print("5. Use that app password in EMAIL_HOST_PASSWORD")
    print("\n🔗 Direct link: https://myaccount.google.com/apppasswords")

if __name__ == '__main__':
    success = test_email_config()
    if not success:
        show_gmail_setup_guide()