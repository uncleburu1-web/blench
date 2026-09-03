"""
Django settings for the GPS LAPTOP shop-management API.
"""

from pathlib import Path
from datetime import timedelta
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY', default='django-insecure-change-me-in-production')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

INSTALLED_APPS = [
    'daphne',  # must load first — patches `runserver` to be ASGI/WebSocket-aware for local dev
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # third party
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'django_filters',
    'channels',

    # local apps
    'core',
    'staff',
    'suppliers',
    'inventory',
    'repairs',
    'sales',
    'liabilities',
    'reports',
    'devices',
    'subscriptions',
    'sync',
    'customers',
    'realtime',
    'branches',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'benchline.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
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

WSGI_APPLICATION = 'benchline.wsgi.application'
ASGI_APPLICATION = 'benchline.asgi.application'

# ---------------------------------------------------------------------------
# Channel layer — how WebSocket consumers on different processes talk to
# each other (needed so a broadcast from an HTTP request, handled by a
# gunicorn/WSGI worker, reaches a WebSocket connection open on a *different*
# process). In-memory by default: correct and zero-setup for a single
# process (fine for this shop's current scale), but it does NOT broadcast
# across multiple processes/dynos — set REDIS_URL once running more than
# one worker and this switches to the real (Redis-backed) layer with no
# other code changes needed.
# ---------------------------------------------------------------------------
REDIS_URL = config('REDIS_URL', default='')
if REDIS_URL:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {'hosts': [REDIS_URL]},
        }
    }
else:
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

# ---------------------------------------------------------------------------
# Database — Postgres by default, override with env vars (see .env.example).
# Falls back to sqlite only when USE_SQLITE=True, which is handy for quick
# local checks that don't need a running Postgres server.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Database — set DATABASE_URL in .env to point at Postgres (Render, Railway,
# etc.), or set USE_SQLITE=True for a quick local check with no Postgres
# running. No hardcoded fallback connection string on purpose — see the
# comment down at DATABASES for why.
# ---------------------------------------------------------------------------
import dj_database_url

if config('USE_SQLITE', default=False, cast=bool):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }
else:
    DATABASES = {
        'default': dj_database_url.parse(
            # No credentialed fallback here on purpose — a hardcoded
            # DATABASE_URL default was flagged once before and slipped
            # back in; if this env var is genuinely unset, fail loudly
            # rather than silently falling back to a live, exposed DB.
            config('DATABASE_URL'),
            conn_max_age=600,
            ssl_require=config('DB_SSL_REQUIRE', default=True, cast=bool),
        )
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = config('TIME_ZONE', default='Africa/Lagos')
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ---------------------------------------------------------------------------
# DRF + JWT
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=14),
    'ROTATE_REFRESH_TOKENS': True,
}

# ---------------------------------------------------------------------------
# CORS — allow the React dev server / deployed frontend origin.
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://127.0.0.1:5173',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

# ---------------------------------------------------------------------------
# Paystack — subscription billing (SaaS). Keys come from the environment
# ONLY, never a hardcoded default — see the DATABASE_URL comment above for
# why that matters. Set the real values in your local .env (gitignored)
# and in Railway's environment variables for production; never commit them.
# PAYSTACK_SECRET_KEY is server-side only (charges, webhook verification —
# never sent to a client). PAYSTACK_PUBLIC_KEY is safe to expose to the
# frontend/desktop, since that's what Paystack's own checkout JS expects.
# ---------------------------------------------------------------------------
PAYSTACK_SECRET_KEY = config('PAYSTACK_SECRET_KEY', default='')
PAYSTACK_PUBLIC_KEY = config('PAYSTACK_PUBLIC_KEY', default='')
