"""
Django settings for ARTX Platform
"""
import os
from pathlib import Path
from decouple import config

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = config('SECRET_KEY', default='l2nk9k_v$jj%1r&)e935@n0+=pj!-$9y1tqar^(ieojgj_e9$5')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = config('DEBUG', default='True') in ['True', 'true', '1', 'yes']

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1,testserver', cast=lambda v: [s.strip() for s in v.split(',')])

# Ensure testserver is always allowed for testing
if 'testserver' not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append('testserver')

# Render sets RENDER_EXTERNAL_HOSTNAME automatically — add it so Django
# doesn't return 400 Bad Request on production without manual config
_render_host = config('RENDER_EXTERNAL_HOSTNAME', default='')
if _render_host and _render_host not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(_render_host)
    ALLOWED_HOSTS.append('testserver')

# Application definition
DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

THIRD_PARTY_APPS = [
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_extensions',
    'django_filters',
    'channels',
]

LOCAL_APPS = [
    'users',
    'payments',
    'tournaments',
    'alliances',
    'notifications',
    'chatbot',
    'challenges',
    'social',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'artx_platform.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'artx_platform.wsgi.application'
ASGI_APPLICATION = 'artx_platform.asgi.application'

# Channels configuration
REDIS_URL = config('REDIS_URL', default='')

if REDIS_URL:
    # Production with Redis (recommended for multi-worker deployments)
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [REDIS_URL],
                'capacity': 100,        # max messages per channel
                'expiry':   10,         # seconds before message expires
            },
        },
    }
else:
    # No Redis — InMemoryChannelLayer with a capped capacity to prevent
    # unbounded RAM growth on Render's free tier.
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
            'CONFIG': {
                'capacity': 50,   # drop oldest messages when full
                'expiry':   10,
            },
        },
    }

# Database
import dj_database_url

# Render provides DATABASE_URL. Fix postgres:// → postgresql:// for Django compatibility.
_raw_db_url = config('DATABASE_URL', default=None)
if _raw_db_url and _raw_db_url.startswith('postgres://'):
    _raw_db_url = _raw_db_url.replace('postgres://', 'postgresql://', 1)

if _raw_db_url:
    DATABASES = {
        'default': dj_database_url.config(
            default=_raw_db_url,
            conn_max_age=60,        # 60 s — avoids exhausting free-tier connection pool
            ssl_require=not DEBUG,
        )
    }
else:
    # Local development only — SQLite
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    BASE_DIR / 'static',
]

# Media files
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Cap request sizes to protect free-tier RAM (5 MB body, 3 MB per file)
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024   # 5 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024   # 3 MB

# Custom User Model
AUTH_USER_MODEL = 'users.User'

# Authentication backends — email-first login
AUTHENTICATION_BACKENDS = [
    'users.backends.EmailOrUsernameBackend',
    'django.contrib.auth.backends.ModelBackend',
]

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.TokenAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    # Mobile-friendly parsers - handle various content-type formats
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ],
    # Better error responses
    'EXCEPTION_HANDLER': 'rest_framework.views.exception_handler',
}

# CORS settings
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000',
    cast=lambda v: [s.strip() for s in v.split(',')]
)

# Allow all origins in development; use explicit list in production
if DEBUG:
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOW_ALL_ORIGINS = False
    # Render automatically sets RENDER_EXTERNAL_URL — add it so the
    # frontend can talk to the backend without a manual env var update
    _render_url = config('RENDER_EXTERNAL_URL', default='').rstrip('/')
    if _render_url and _render_url not in CORS_ALLOWED_ORIGINS:
        CORS_ALLOWED_ORIGINS.append(_render_url)

CORS_ALLOW_CREDENTIALS = True

# Allow common mobile headers
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# Email Configuration
# Set to 'console' to print emails to terminal (for testing)
# Set to 'smtp' to send real emails via Gmail
EMAIL_MODE = config('EMAIL_MODE', default='smtp')

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')

if EMAIL_MODE == 'smtp':
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'

DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='ARTX Platform <noreply@artx.com>')

# Payment Provider Configuration
# ⚠️ IMPORTANT: All API keys should be in .env file, NOT in code
STRIPE_PUBLISHABLE_KEY = config('STRIPE_PUBLISHABLE_KEY', default='')
STRIPE_SECRET_KEY = config('STRIPE_SECRET_KEY', default='')
STRIPE_WEBHOOK_SECRET = config('STRIPE_WEBHOOK_SECRET', default='')

# PawaPay Configuration (African Mobile Money)
PAWAPAY_API_KEY = config('PAWAPAY_API_KEY', default='')
PAWAPAY_API_URL = config('PAWAPAY_API_URL', default='https://api.pawapay.cloud')
PAWAPAY_WEBHOOK_SECRET = config('PAWAPAY_WEBHOOK_SECRET', default='')

# Paystack
PAYSTACK_SECRET_KEY = config('PAYSTACK_SECRET_KEY', default='')

# OpenAI Configuration (for AI Chatbot)
# ⚠️ IMPORTANT: Keep this in .env file ONLY - DO NOT commit to git
OPENAI_API_KEY = config('OPENAI_API_KEY', default='')

# Logging — console-only (no filesystem writes; Render's disk is ephemeral)
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'level': 'WARNING',   # INFO is too noisy in production; use WARNING+
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'artx_platform': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'payments': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'WARNING',
    },
}

# CSRF trusted origins — built unconditionally so it works in both
# DEBUG and non-DEBUG modes. Render sets RENDER_EXTERNAL_HOSTNAME and
# RENDER_EXTERNAL_URL automatically; CSRF_TRUSTED_ORIGINS env var is an
# explicit escape-hatch for any additional domains.
_csrf_origins = ['http://localhost:8000', 'http://127.0.0.1:8000']
if _render_host:
    _csrf_origins.append(f'https://{_render_host}')
_render_ext_url = config('RENDER_EXTERNAL_URL', default='').rstrip('/')
if _render_ext_url and _render_ext_url not in _csrf_origins:
    _csrf_origins.append(_render_ext_url)
_extra_origins = config(
    'CSRF_TRUSTED_ORIGINS',
    default='',
    cast=lambda v: [s.strip() for s in v.split(',') if s.strip()]
)
for _o in _extra_origins:
    if _o not in _csrf_origins:
        _csrf_origins.append(_o)
CSRF_TRUSTED_ORIGINS = _csrf_origins

# Security settings for production
if not DEBUG:
    SECURE_BROWSER_XSS_FILTER = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_REDIRECT_EXEMPT = []
    # Render terminates SSL at its proxy — tell Django the request is HTTPS
    # when the X-Forwarded-Proto header says so. Without this, Django thinks
    # all requests are HTTP and the admin login CSRF check fails.
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
