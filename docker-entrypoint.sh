#!/bin/sh
# Inside the container, 127.0.0.1 is the container itself, not the Mac. The database is published on
# the Mac's loopback (the contractor-agent-db container), so the same .env works in both places once
# its host is rewritten to host.docker.internal here.
set -e
for name in DATABASE_URL DIRECT_URL; do
  value=$(printenv "$name" || true)
  if [ -n "$value" ]; then
    export "$name=$(printf '%s' "$value" | sed -E 's#@(127\.0\.0\.1|localhost)([:/])#@host.docker.internal\2#')"
  fi
done
exec "$@"
