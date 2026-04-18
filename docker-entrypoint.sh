#!/bin/sh
set -e

export HEALTHCHECK_FILE="${HEALTHCHECK_FILE:-/run/healthcheck}"

if [ -n "$CRON" ]; then
  echo "$CRON node /app/src/index.js" > /app/crontab
  if [ -n "$CRON_SENTRY_DSN" ]; then
    export SENTRY_DSN="$CRON_SENTRY_DSN"
  fi
  echo "Running with cron schedule: $CRON"
  exec /usr/local/bin/supercronic /app/crontab
else
  echo "Running without cron"
  exec node /app/src/index.js
fi
