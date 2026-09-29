#!/usr/bin/env bash
# One-time setup for deploying main automatically, run from your normal checkout:
#   - a detached worktree that only ever holds origin/main (default ~/.contractor-agent/deploy),
#   - links from it to this checkout's .env and .env.local, so there is one copy of each,
#   - a launchd job that runs `deploy-main.sh --if-changed` every 5 minutes.
#
#   ./scripts/deploy-setup.sh              install (safe to re-run)
#   ./scripts/deploy-setup.sh --uninstall  remove the launchd job (the worktree is left in place)
set -euo pipefail

dev=$(cd "$(dirname "$0")/.." && pwd)
deploy="${CONTRACT_AGENT_DEPLOY_DIR:-$HOME/.contractor-agent/deploy}"
state="$HOME/.contractor-agent/deploy-state"
label=com.contractor-agent.deploy-watch
plist="$HOME/Library/LaunchAgents/$label.plist"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "Automatic deploys removed. The worktree at $deploy is still there."
  exit 0
fi

git -C "$dev" fetch --quiet origin main
if [ ! -d "$deploy" ]; then git -C "$dev" worktree add --quiet --detach "$deploy" origin/main; fi
for file in .env .env.local; do
  if [ -e "$dev/$file" ]; then ln -sfn "$dev/$file" "$deploy/$file"; fi
done

mkdir -p "$(dirname "$plist")" "$state"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$deploy/scripts/deploy-main.sh</string><string>--if-changed</string></array>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$state/launchd.log</string>
  <key>StandardErrorPath</key><string>$state/launchd.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Deploy worktree: $deploy"
echo "Checking origin/main every 5 minutes. Log: $state/deploy.log"
