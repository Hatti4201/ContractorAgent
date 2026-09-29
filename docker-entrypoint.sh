#!/bin/sh
# Inside the container, 127.0.0.1 is the container itself, not the Mac, so the same .env works in both
# places once its Mac-loopback addresses are pointed at the Mac here.
set -e

# The database is published on the Mac's loopback (the contractor-agent-db container).
for name in DATABASE_URL DIRECT_URL; do
  value=$(printenv "$name" || true)
  if [ -n "$value" ]; then
    export "$name=$(printf '%s' "$value" | sed -E 's#@(127\.0\.0\.1|localhost)([:/])#@host.docker.internal\2#')"
  fi
done

# The dedicated Dice Chrome listens on the Mac's loopback too, but Chrome's DevTools refuses any Host
# header that is a name other than localhost, so the Mac is reached by its IPv4 address instead of
# host.docker.internal. Looked up at every start: Docker Desktop assigns it and it can change.
mac_ip=$(getent ahostsv4 host.docker.internal | head -n 1 | cut -d ' ' -f 1)
if [ -n "$mac_ip" ]; then
  cdp=${EXPOSURE_CDP_URL:-http://127.0.0.1:9222}
  export EXPOSURE_CDP_URL="$(printf '%s' "$cdp" | sed -E "s#//(127\.0\.0\.1|localhost)([:/]|\$)#//$mac_ip\2#")"
fi

exec "$@"
