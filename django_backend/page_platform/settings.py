"""
Django settings for PAGE Platform
"""
import os
from pathlib import Path
from decouple import config, Csv
import dj_database_url

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

# ─── Security ─────────────────────────────────────────────────────────────────
SECRET_KEY = config('SECRET_KEY', default='django-insecure-change-me-in-production')
DEBUG = config('DEBUG', default=False, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

# ─── Application definition ───────────────────────────────────────────────────
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third-party
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'django_filters',
    'django_extensions',
    'channels',
    'cloudinary',
    'cloudinary_storage',

    # Project apps
    'users',
    'challenges',
    'tournaments',
    'alliances',
    'payments',
    'messenger',
    'notifications',
    'social',
    'chatbot',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'page_platform.urls'

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

WSGI_APPLICATION = 'page_platform.wsgi.application'
ASGI_APPLICATION = 'page_platform.asgi.application'

# ─── Database ─────────────────────────────────────────────────────────────────
_db_url = config('DATABASE_URL', default=f'sqlite:///{BASE_DIR / "db.sqlite3"}')
DATABASES = {
    'default': dj_database_url.parse(_db_url, conn_max_age=600)
}

# ─── Authentication ───────────────────────────────────────────────────────────
AUTH_USER_MODEL = 'users.User'

AUTHENTICATION_BACKENDS = [
    # Firebase ID-token auth (used when Firebase is configured)
    'users.firebase_auth_backend.FirebaseAuthenticationBackend',
    # Email OR username login (case-insensitive) — used by the legacy login view
    'users.backends.EmailOrUsernameBackend',
    # Fallback — required by Django admin
    'django.contrib.auth.backends.ModelBackend',
]

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ─── REST Framework ───────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}

# ─── CORS ─────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

# ─── Channels / WebSockets ────────────────────────────────────────────────────
_redis_url = config('REDIS_URL', default='').strip().strip('"').strip("'").strip()

if _redis_url and any(_redis_url.startswith(s) for s in ('redis://', 'rediss://', 'unix://')):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [_redis_url],
                'capacity': 1500,
                'expiry': 10,
            },
        }
    }
    REDIS_URL = _redis_url
else:
    # Fallback for local dev or when Redis is not configured
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }

# ─── Internationalisation ─────────────────────────────────────────────────────
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# ─── Static & Media files ─────────────────────────────────────────────────────
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'

# Allow WhiteNoise to serve files from STATICFILES_DIRS in development
WHITENOISE_USE_FINDERS = True

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ─── Cloudinary (media storage) ───────────────────────────────────────────────
CLOUDINARY_STORAGE = {
    'CLOUD_NAME': config('CLOUDINARY_CLOUD_NAME', default='').strip(),
    'API_KEY':    config('CLOUDINARY_API_KEY', default='').strip(),
    'API_SECRET': config('CLOUDINARY_API_SECRET', default='').strip(),
}

_cloudinary_configured = all([
    CLOUDINARY_STORAGE['CLOUD_NAME'],
    CLOUDINARY_STORAGE['API_KEY'],
    CLOUDINARY_STORAGE['API_SECRET'],
])

if _cloudinary_configured:
    DEFAULT_FILE_STORAGE = 'cloudinary_storage.storage.MediaCloudinaryStorage'
    # Startup diagnostic — logs key shape so mismatches are visible in Render logs.
    # Never logs the full secret; only the first/last 4 chars and total length.
    import logging as _logging
    _cld_log = _logging.getLogger('cloudinary.config')
    _key    = CLOUDINARY_STORAGE['API_KEY']
    _secret = CLOUDINARY_STORAGE['API_SECRET']
    _cld_log.info(
        f"Cloudinary configured: cloud={CLOUDINARY_STORAGE['CLOUD_NAME']!r} "
        f"key={_key[:4]}...{_key[-4:]}(len={len(_key)}) "
        f"secret={_secret[:4]}...{_secret[-4:]}(len={len(_secret)})"
    )
    del _cld_log, _key, _secret
else:
    import logging as _logging
    _logging.getLogger('cloudinary.config').warning(
        'Cloudinary NOT configured — media uploads will use local storage.'
    )

# ─── Email ────────────────────────────────────────────────────────────────────
EMAIL_PROVIDER = config('EMAIL_PROVIDER', default='console')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='PAGE Platform <noreply@pageplatform.com>')
FRONTEND_BASE_URL = config('FRONTEND_BASE_URL', default='http://localhost:8000')

if EMAIL_PROVIDER == 'resend':
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    RESEND_API_KEY = config('RESEND_API_KEY', default='')
elif EMAIL_PROVIDER == 'smtp':
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
    EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
    EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
    EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
    EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
else:
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# ─── Payments ─────────────────────────────────────────────────────────────────
STRIPE_PUBLISHABLE_KEY = config('STRIPE_PUBLISHABLE_KEY', default='')
STRIPE_SECRET_KEY = config('STRIPE_SECRET_KEY', default='')
STRIPE_WEBHOOK_SECRET = config('STRIPE_WEBHOOK_SECRET', default='')

PAWAPAY_API_KEY = config('PAWAPAY_API_KEY', default='')
PAWAPAY_API_URL = config('PAWAPAY_API_URL', default='https://api.pawapay.cloud')
PAWAPAY_WEBHOOK_SECRET = config('PAWAPAY_WEBHOOK_SECRET', default='')

PAYSTACK_SECRET_KEY = config('PAYSTACK_SECRET_KEY', default='')

# ─── SMS ──────────────────────────────────────────────────────────────────────
SMS_PROVIDER = config('SMS_PROVIDER', default='console')

TWILIO_ACCOUNT_SID = config('TWILIO_ACCOUNT_SID', default='')
TWILIO_AUTH_TOKEN = config('TWILIO_AUTH_TOKEN', default='')
TWILIO_PHONE_NUMBER = config('TWILIO_PHONE_NUMBER', default='')

AFRICASTALKING_USERNAME = config('AFRICASTALKING_USERNAME', default='')
AFRICASTALKING_API_KEY = config('AFRICASTALKING_API_KEY', default='')
AFRICASTALKING_SENDER_ID = config('AFRICASTALKING_SENDER_ID', default='PAGE')

# ─── AI / Chatbot ─────────────────────────────────────────────────────────────
GROQ_API_KEY = config('GROQ_API_KEY', default='')
OPENAI_API_KEY = config('OPENAI_API_KEY', default='')
GEMINI_API_KEY = config('GEMINI_API_KEY', default='')

# ─── Firebase / Firestore ─────────────────────────────────────────────────────
# Method 1 (recommended on Render): paste the entire serviceAccountKey.json
# contents as a single env var — no PEM line-ending issues.
FIREBASE_SERVICE_ACCOUNT_JSON = config('FIREBASE_SERVICE_ACCOUNT_JSON', default='')

# Method 2 (fallback): individual fields from the service account JSON
FIREBASE_PROJECT_ID = config('FIREBASE_PROJECT_ID', default='')
FIREBASE_PRIVATE_KEY_ID = config('FIREBASE_PRIVATE_KEY_ID', default='')
FIREBASE_PRIVATE_KEY = config('FIREBASE_PRIVATE_KEY', default='').replace('\\n', '\n')
FIREBASE_CLIENT_EMAIL = config('FIREBASE_CLIENT_EMAIL', default='')
FIREBASE_CLIENT_ID = config('FIREBASE_CLIENT_ID', default='')
FIREBASE_CLIENT_X509_CERT_URL = config('FIREBASE_CLIENT_X509_CERT_URL', default='')

FIREBASE_WEB_API_KEY = config('FIREBASE_WEB_API_KEY', default='')
FIREBASE_AUTH_DOMAIN = config('FIREBASE_AUTH_DOMAIN', default='')
FIREBASE_STORAGE_BUCKET = config('FIREBASE_STORAGE_BUCKET', default='')
FIREBASE_MESSAGING_SENDER_ID = config('FIREBASE_MESSAGING_SENDER_ID', default='')
FIREBASE_APP_ID = config('FIREBASE_APP_ID', default='')

# ─── Firestore feature flags ──────────────────────────────────────────────────
FS_NOTIFICATIONS = config('FS_NOTIFICATIONS', default=False, cast=bool)
FS_ACTIVITIES = config('FS_ACTIVITIES', default=False, cast=bool)
FS_CHATBOT = config('FS_CHATBOT', default=False, cast=bool)
FS_CHALLENGES = config('FS_CHALLENGES', default=False, cast=bool)
FS_SUBMISSIONS = config('FS_SUBMISSIONS', default=False, cast=bool)
FS_SOCIAL = config('FS_SOCIAL', default=False, cast=bool)
FS_ALLIANCES = config('FS_ALLIANCES', default=False, cast=bool)
FS_USERS = config('FS_USERS', default=False, cast=bool)
FS_PAYMENTS = config('FS_PAYMENTS', default=False, cast=bool)

# Dict consumed by views/services via settings.FIRESTORE_COLLECTIONS.get(...)
FIRESTORE_COLLECTIONS = {
    'notifications':        FS_NOTIFICATIONS,
    'activities':           FS_ACTIVITIES,
    'chatbot':              FS_CHATBOT,
    'challenges':           FS_CHALLENGES,
    'challenge_activities': FS_CHALLENGES,   # shares the challenges flag
    'submissions':          FS_SUBMISSIONS,
    'social':               FS_SOCIAL,
    'alliances':            FS_ALLIANCES,
    'users':                FS_USERS,
    'payments':             FS_PAYMENTS,
}

# ─── Logging ──────────────────────────────────────────────────────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': config('DJANGO_LOG_LEVEL', default='INFO'),
            'propagate': False,
        },
        # Suppress noisy 404s from bots/crawlers that aren't real errors
        'django.request': {
            'handlers': ['console'],
            'level': 'ERROR',   # only log 500s, not 404s
            'propagate': False,
        },
        'channels': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        # Auth debugging — shows up in Render logs
        'users.login': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
        'users.backends': {
            'handlers': ['console'],
            'level': 'DEBUG',
            'propagate': False,
        },
    },
}

# ─── Security hardening (production) ─────────────────────────────────────────
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SECURE_SSL_REDIRECT = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
