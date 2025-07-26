#!/bin/sh
set -e

# Ensure data directory exists and has correct permissions
DATA_DIR="${ACTUAL_DATA_DIR:-./data}"
mkdir -p "$DATA_DIR"
# Since we're running as node user, we need to make sure we have permissions
if [ -w "$DATA_DIR" ]; then
  echo "Data directory $DATA_DIR is writable"
else
  echo "Warning: Data directory $DATA_DIR is not writable by node user"
fi

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
