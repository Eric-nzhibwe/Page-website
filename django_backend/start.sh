#!/usr/bin/env bash
# ── ARTX start script for Render ──────────────────────────────────────────────
# Runs migrate with retries THEN starts uvicorn.
# Render's port-scan window is ~5 min on free tier; we give migrate 3 attempts
# of 60 s each before giving up and starting the server anyway (so the service
# comes online even if the DB is temporarily unavailable — it will just 500 on
# DB-dependent requests until the DB wakes up, which is better than a failed
# deploy).
set -e

MAX_RETRIES=3
RETRY_DELAY=10  # seconds between attempts

echo "==> Running database migrations..."
for i in $(seq 1 $MAX_RETRIES); do
    if python manage.py migrate --no-input; then
        echo "==> Migrations complete."
        break
    else
        echo "   Attempt $i/$MAX_RETRIES failed. Retrying in ${RETRY_DELAY}s..."
        sleep $RETRY_DELAY
    fi
    if [ "$i" = "$MAX_RETRIES" ]; then
        echo "   WARNING: Migrations failed after $MAX_RETRIES attempts. Starting server anyway."
    fi
done

echo "==> Starting uvicorn..."
exec uvicorn artx_platform.asgi:application \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers 1 \
    --lifespan off
