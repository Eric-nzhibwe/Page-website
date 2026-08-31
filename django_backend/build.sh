#!/bin/bash
# Build script for Render deployment
set -e  # Exit immediately on any error

echo "==> Installing Python dependencies"
pip install -r requirements.txt

echo "==> Copying frontend files to static directory"
mkdir -p static/frontend
cp -r ../index.html static/frontend/
cp -r ../pages static/frontend/
cp -r ../scripts static/frontend/
cp -r ../styles static/frontend/
cp -r ../images static/frontend/

echo "==> Collecting static files"
python manage.py collectstatic --no-input

# NOTE: migrate, makemigrations, and ensure_superuser are intentionally NOT run
# here. Render's build environment has no outbound network access, so any
# command that connects to the database will fail. These steps are run instead
# via a release/start command that executes at runtime, where the network is
# available. See the Render dashboard Start Command.

echo "==> Verifying email configuration"
python - <<'PYEOF'
import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

import django
django.setup()

from django.conf import settings

provider = getattr(settings, 'EMAIL_PROVIDER', 'console')
print(f"   EMAIL_PROVIDER   = {provider}")
print(f"   DEFAULT_FROM     = {settings.DEFAULT_FROM_EMAIL}")
print(f"   FRONTEND_BASE    = {getattr(settings, 'FRONTEND_BASE_URL', '(not set)')}")

if provider == 'resend':
    key = getattr(settings, 'RESEND_API_KEY', '')
    if not key:
        print("   ERROR: EMAIL_PROVIDER=resend but RESEND_API_KEY is not set!")
        print("   -> Set RESEND_API_KEY in the Render dashboard environment variables.")
        sys.exit(1)
    print(f"   RESEND_API_KEY   = re_...{key[-4:]} (set)")
    # Quick HTTPS connectivity test to Resend
    import urllib.request
    try:
        urllib.request.urlopen('https://api.resend.com', timeout=8)
    except Exception as e:
        # A 405/403 response still means the host is reachable
        err = str(e)
        if 'HTTP Error' in err or 'Forbidden' in err or '405' in err or '401' in err:
            print("   Resend HTTPS endpoint reachable -- OK")
        else:
            print(f"   WARNING: Could not reach api.resend.com: {e}")
            print("   Emails may fail at runtime. Check network/firewall.")

elif provider == 'smtp':
    if not settings.EMAIL_HOST_USER:
        print("   WARNING: EMAIL_HOST_USER is empty -- emails will fail!")
    if not settings.EMAIL_HOST_PASSWORD:
        print("   WARNING: EMAIL_HOST_PASSWORD is empty -- emails will fail!")
    import socket
    try:
        s = socket.create_connection((settings.EMAIL_HOST, settings.EMAIL_PORT), timeout=8)
        s.close()
        print(f"   SMTP TCP connect to {settings.EMAIL_HOST}:{settings.EMAIL_PORT} -- OK")
    except OSError as e:
        print(f"   WARNING: Cannot reach SMTP server ({e})")
        print("   On Render free tier, use EMAIL_PROVIDER=resend instead.")

else:
    print("   Console mode -- emails printed to stdout only (dev mode)")

frontend_url = getattr(settings, 'FRONTEND_BASE_URL', '')
if not frontend_url or 'localhost' in frontend_url:
    print("   WARNING: FRONTEND_BASE_URL points to localhost.")
    print("   Password reset links will be broken in production.")
    print("   Set FRONTEND_BASE_URL=https://your-app.onrender.com")

print("   Email config check complete.")
PYEOF

echo "==> Build complete"
