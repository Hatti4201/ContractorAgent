#!/usr/bin/env bash
# Deploys the latest origin/main to the contract-agent container: build, migrate, swap, health check,
# roll back on failure. Runs from the deploy worktree (scripts/deploy-setup.sh), never from a folder a
# coding agent is working in, so it can check out main without touching anyone's branch.
#
#   ./scripts/deploy-main.sh                       deploy now
#   ./scripts/deploy-main.sh --if-changed          only if origin/main moved (what launchd runs)
#   ./scripts/deploy-main.sh --allow-destructive   also apply a migration that drops, renames or retypes
#                                                  (take a pg_dump first; CLAUDE.md §16)
#   DEPLOY_REF=<local ref> ./scripts/deploy-main.sh   deploy a local commit without fetching (for testing)
set -euo pipefail

# Everything is inside main(): bash reads a function whole before running it, and the checkout below
# can rewrite this very file.
main() {
  local if_changed=false allow_destructive=false
  for arg in "$@"; do
    case "$arg" in
      --if-changed) if_changed=true ;;
      --allow-destructive) allow_destructive=true ;;
      *) echo "Unknown option: $arg" >&2; return 2 ;;
    esac
  done

  cd "$(dirname "$0")/.."
  local state="$HOME/.contractor-agent/deploy-state"
  local image=contractjobagent-contract-agent
  mkdir -p "$state"
  log() { echo "$(date '+%F %T') $*" | tee -a "$state/deploy.log"; }

  # One deploy at a time: the launchd check and a manual run must not overlap.
  if ! mkdir "$state/lock" 2>/dev/null; then
    $if_changed || echo "A deploy is already running." >&2
    return 0
  fi
  # Expanded now: the trap fires after main() has returned and its locals are gone.
  trap "rmdir '$state/lock'" EXIT

  local target current
  if [ -n "${DEPLOY_REF:-}" ]; then
    target=$(git rev-parse "$DEPLOY_REF")
  else
    git fetch --quiet origin main
    target=$(git rev-parse origin/main)
  fi
  current=$(cat "$state/deployed-sha" 2>/dev/null || echo none)
  if $if_changed && [ "$target" = "$current" ]; then return 0; fi
  # A commit that already failed is not retried every five minutes, each time taking the app down for
  # the length of a health check; a manual run (or the next commit on main) tries again.
  if $if_changed && [ "$target" = "$(cat "$state/failed-sha" 2>/dev/null)" ]; then return 0; fi

  log "Deploying ${target:0:7} (running: ${current:0:7})"
  git checkout --quiet --detach "$target"

  # Keep the running image, so a new one that fails its health check can be put back.
  if docker image inspect "$image:latest" >/dev/null 2>&1; then docker tag "$image:latest" "$image:previous"; fi
  docker compose build --quiet contract-agent

  # Migrations run from the new image, before the swap. Additive ones are harmless to the old code;
  # anything that drops, renames or retypes waits for the user (CLAUDE.md §16).
  local pending destructive=""
  pending=$(docker compose run --rm --no-deps contract-agent npx prisma migrate status 2>&1 \
    | awk '/not yet been applied/{on=1; next} on && NF==0{on=0} on{print $1}') || true
  for name in $pending; do
    if grep -Eiq 'DROP (TABLE|COLUMN|TYPE)|RENAME|ALTER COLUMN .* TYPE|SET NOT NULL' "prisma/migrations/$name/migration.sql" 2>/dev/null; then
      destructive="$destructive $name"
    fi
  done
  if [ -n "$destructive" ] && ! $allow_destructive; then
    log "STOPPED: destructive migration(s):$destructive. Take a pg_dump, then run with --allow-destructive."
    echo "$target" > "$state/failed-sha"
    if docker image inspect "$image:previous" >/dev/null 2>&1; then docker tag "$image:previous" "$image:latest"; fi
    return 1
  fi
  if [ -n "$pending" ]; then
    log "Applying migrations: $(echo $pending)"
    docker compose run --rm --no-deps contract-agent npx prisma migrate deploy
  fi

  docker compose up -d --no-build contract-agent

  # Development mode compiles on first request, so give it up to three minutes.
  local code=000
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3008/login || true)
    [ "$code" = "200" ] && break
    sleep 3
  done

  if [ "$code" != "200" ]; then
    log "FAILED health check (last /login status $code). Rolling back to the previous image."
    echo "$target" > "$state/failed-sha"
    if docker image inspect "$image:previous" >/dev/null 2>&1; then
      docker tag "$image:previous" "$image:latest"
      docker compose up -d --no-build --force-recreate contract-agent
    fi
    return 1
  fi

  echo "$target" > "$state/deployed-sha"
  rm -f "$state/failed-sha"
  docker tag "$image:latest" "$image:${target:0:7}"
  log "OK: contract-job-agent is running ${target:0:7}"
}

main "$@"
exit $?
