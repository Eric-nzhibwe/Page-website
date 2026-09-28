"""
WSGI config for PAGE Platform

Exposes the WSGI callable as a module-level variable named ``application``.
Used for traditional WSGI servers (gunicorn). For WebSocket support, use
asgi.py with uvicorn instead.
"""
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'page_platform.settings')

application = get_wsgi_application()
