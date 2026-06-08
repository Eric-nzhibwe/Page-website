#!/bin/bash
# Build script for Render deployment

# Install Python dependencies
pip install -r requirements.txt

# Copy frontend files to static directory
mkdir -p static/frontend
cp -r ../index.html static/frontend/
cp -r ../pages static/frontend/
cp -r ../scripts static/frontend/
cp -r ../styles static/frontend/
cp -r ../images static/frontend/

# Collect static files
python manage.py collectstatic --no-input

# Run migrations
python manage.py migrate
