#!/usr/bin/env bash
# Removes a coding agent's worktree and drops its schema in the development database.
# Refuses a worktree with uncommitted changes, and keeps a branch that is not merged into main.
#
#   ./scripts/remove-worktree.sh <name>
set -euo pipefail

name="${1:-}"
printf '%s' "$name" | grep -Eq '^[a-z][a-z0-9-]{1,30}$' || { echo "Usage: $0 <name>" >&2; exit 2; }
main_dir=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)
root="${CONTRACT_AGENT_WORKTREES:-$(dirname "$main_dir")/contractJobAgent-worktrees}"
dir="$root/$name"
schema="agent_$(printf '%s' "$name" | tr '-' '_')"

if [ -d "$dir" ]; then
  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    echo "$dir has uncommitted changes; commit or discard them first." >&2
    exit 1
  fi
  git -C "$main_dir" worktree remove "$dir"
fi
docker exec contractor-agent-dev-db psql -q -U contractor_dev -d contractor_agent_dev -c "SET client_min_messages TO warning; DROP SCHEMA IF EXISTS \"$schema\" CASCADE;"

git -C "$main_dir" fetch --quiet origin main
if git -C "$main_dir" branch --merged origin/main | grep -qx "  feature/$name"; then
  git -C "$main_dir" branch -d "feature/$name" >/dev/null
  echo "Removed worktree, schema $schema and merged branch feature/$name."
else
  echo "Removed worktree and schema $schema. Branch feature/$name is not merged into main, so it was kept."
fi
