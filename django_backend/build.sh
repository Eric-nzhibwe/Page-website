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

echo "==> Making migrations"
python manage.py makemigrations --no-input

echo "==> Running database migrations"
python manage.py migrate --no-input

echo "==> Creating superuser from env vars (if not exists)"
python manage.py ensure_superuser

echo "==> Verifying email configuration"
python - <<'PYEOF'
import os, sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

import django
django.setup()

from django.conf import settings

mode = getattr(settings, 'EMAIL_MODE', 'console')
print(f"   EMAIL_MODE       = {mode}")
print(f"   EMAIL_BACKEND    = {settings.EMAIL_BACKEND}")
print(f"   EMAIL_HOST       = {settings.EMAIL_HOST}")
print(f"   EMAIL_PORT       = {settings.EMAIL_PORT}")
print(f"   EMAIL_USE_TLS    = {settings.EMAIL_USE_TLS}")
print(f"   EMAIL_HOST_USER  = {settings.EMAIL_HOST_USER or '(not set)'}")
print(f"   FROM             = {settings.DEFAULT_FROM_EMAIL}")
print(f"   FRONTEND_BASE_URL= {getattr(settings, 'FRONTEND_BASE_URL', '(not set)')}")

if mode == 'smtp':
    if not settings.EMAIL_HOST_USER:
        print("   WARNING: EMAIL_HOST_USER is empty — emails will fail!")
        sys.exit(1)
    if not settings.EMAIL_HOST_PASSWORD:
        print("   WARNING: EMAIL_HOST_PASSWORD is empty — emails will fail!")
        sys.exit(1)
    # Quick TCP connection test (does NOT send any email)
    import socket
    try:
        s = socket.create_connection((settings.EMAIL_HOST, settings.EMAIL_PORT), timeout=10)
        s.close()
        print(f"   SMTP TCP connect to {settings.EMAIL_HOST}:{settings.EMAIL_PORT} — OK")
    except OSError as e:
        print(f"   WARNING: Cannot reach SMTP server: {e}")
        print("   Continuing build — emails will fail at runtime if this persists.")
else:
    print("   Console backend active — emails printed to stdout (dev mode)")

frontend_url = getattr(settings, 'FRONTEND_BASE_URL', '')
if not frontend_url or 'localhost' in frontend_url:
    print("   WARNING: FRONTEND_BASE_URL is not set to a production URL.")
    print("   Password reset links will point to localhost. Set it in Render env vars.")

print("   Email config check complete.")
PYEOF

echo "==> Build complete"
