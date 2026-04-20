#!/bin/bash
# Drops and recreates the local litara database, then re-applies all migrations.
# Useful during development when you share a Postgres instance across projects.
#
# Requires: docker running with container named "litara-postgres"

set -e

echo "Dropping litara database..."
docker exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS litara;"

echo "Recreating litara database..."
docker exec postgres psql -U postgres -c "CREATE DATABASE litara;"

echo "Applying migrations..."
(cd "$(dirname "$0")/../apps/api" && npx prisma migrate deploy)

echo "Done. litara database is clean and up to date."
