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

echo "==> Running database migrations"
python manage.py migrate

echo "==> Creating superuser from env vars (if not exists)"
python manage.py ensure_superuser

echo "==> Build complete"
