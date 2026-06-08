"""
WSGI config for ARTX Platform project.
"""
import os
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'artx_platform.settings')

application = get_wsgi_application()