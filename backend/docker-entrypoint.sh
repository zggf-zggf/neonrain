#!/bin/sh
set -e

echo "Running database migrations..."
if ! npx prisma migrate deploy; then
  echo "Migration failed, resetting database..."
  npx prisma migrate reset --force
fi

echo "Starting application..."
exec npm start
