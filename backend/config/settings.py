"""
Django settings for the RentEase project.

Secrets and database credentials are read from a local `.env` file
(see `.env.example`). Never commit the real `.env`.
"""

import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / '.env')


def env(name, default=None, required=False):
    value = os.environ.get(name, default)
    if required and not value:
        raise ImproperlyConfigured(
            f'Missing environment variable {name}. Copy .env.example to .env and fill it in.'
        )
    return value


SECRET_KEY = env('SECRET_KEY', required=True)
DEBUG = env('DEBUG', 'False').lower() in ('1', 'true', 'yes')
ALLOWED_HOSTS = [h.strip() for h in env('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'accounts',
    'properties',
    'payments',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database: PostgreSQL (Supabase). Set DATABASE_URL in .env, e.g.
# postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
# Without DATABASE_URL, a local SQLite file (db.sqlite3) is used for quick local testing.
DATABASES = {
    'default': dj_database_url.parse(
        env('DATABASE_URL') or f'sqlite:///{BASE_DIR / "db.sqlite3"}',
        conn_max_age=60,
        conn_health_checks=True,
    )
}


# Authentication
AUTH_USER_MODEL = 'accounts.User'
AUTHENTICATION_BACKENDS = ['accounts.backends.EmailOrUsernameBackend']
# The Django admin sends signed-out visitors to its own login page; the React app has /login.
LOGIN_URL = '/login'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Manila'
USE_I18N = True
USE_TZ = True


STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# The built React app. `npm run build` in frontend/ writes it here; its files are
# served under /static/ and index.html is served for every page URL (config/urls.py).
FRONTEND_DIST = BASE_DIR.parent / 'frontend' / 'dist'
STATICFILES_DIRS = [BASE_DIR / 'static'] + ([FRONTEND_DIST] if FRONTEND_DIST.exists() else [])


# JSON API used by the React frontend (Django REST Framework).
# Sign-in uses Django sessions (cookie) with CSRF protection. In development the
# Vite dev server forwards /api to Django, so the browser sees a single origin.
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['accounts.api_utils.CsrfSessionAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}

# Vite dev server origins allowed to send CSRF-protected requests.
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env('CSRF_TRUSTED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if o.strip()]

# Uploaded profile photos
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
