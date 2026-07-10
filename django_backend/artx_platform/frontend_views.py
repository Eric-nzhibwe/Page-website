"""
Frontend file serving views for ARTX Platform
"""
import os
import mimetypes
from django.http import Http404, HttpResponse
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
import logging

logger = logging.getLogger(__name__)

@csrf_exempt
def serve_frontend_file(request, file_path=''):
    """Serve frontend files with proper MIME types"""
    if not file_path:
        file_path = 'index.html'
    
    # Get the project root (parent of django_backend)
    project_root = os.path.dirname(settings.BASE_DIR)
    
    # Normalize path separators for Windows
    file_path = file_path.replace('\\', '/')
    full_path = os.path.join(project_root, file_path)
    
    # Convert to absolute path and normalize
    full_path = os.path.abspath(full_path)
    project_root = os.path.abspath(project_root)
    
    # Security check - ensure we're not serving files outside the project
    if not full_path.startswith(project_root):
        logger.error(f"Security: Access denied for path: {file_path}")
        raise Http404("Access denied")
    
    # Check if file exists
    if os.path.exists(full_path) and os.path.isfile(full_path):
        # Determine MIME type
        content_type, _ = mimetypes.guess_type(full_path)
        
        # Set default content type for unknown files
        if content_type is None:
            if file_path.endswith('.html'):
                content_type = 'text/html; charset=utf-8'
            elif file_path.endswith('.css'):
                content_type = 'text/css; charset=utf-8'
            elif file_path.endswith('.js'):
                content_type = 'application/javascript; charset=utf-8'
            elif file_path.endswith('.json'):
                content_type = 'application/json; charset=utf-8'
            elif file_path.endswith(('.jpg', '.jpeg')):
                content_type = 'image/jpeg'
            elif file_path.endswith('.png'):
                content_type = 'image/png'
            elif file_path.endswith('.gif'):
                content_type = 'image/gif'
            elif file_path.endswith('.ico'):
                content_type = 'image/x-icon'
            else:
                content_type = 'application/octet-stream'
        
        try:
            # Read and return file
            with open(full_path, 'rb') as f:
                content = f.read()
                response = HttpResponse(content, content_type=content_type)
                
                # Add cache headers for static files
                if file_path.endswith(('.css', '.js', '.jpg', '.png', '.gif', '.ico')):
                    response['Cache-Control'] = 'public, max-age=3600'
                
                # Add content length
                response['Content-Length'] = len(content)
                
                return response
                
        except Exception as e:
            logger.error(f"Error reading file {file_path}: {e}")
            raise Http404(f"Error reading file: {file_path}")
    else:
        # Only log non-media 404s to avoid spam from ephemeral upload files
        if not file_path.startswith('media/'):
            logger.warning(f"File not found: {file_path}")
        raise Http404(f"File not found: {file_path}")

@csrf_exempt
def serve_favicon(request):
    """Serve favicon from images directory"""
    return serve_frontend_file(request, 'images/ARTX.jpg')