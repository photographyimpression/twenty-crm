#!/bin/bash
# Install/restart the QuickBooks bridge LaunchAgent on the studio Mac.
# Idempotent — safe to run after every change to server.js.
set -euo pipefail

LABEL="ca.impressionphotography.quickbooks-bridge"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_JS="$REPO_DIR/tools/quickbooks-bridge/server.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="$(command -v node || true)"
[ -z "$NODE_BIN" ] && NODE_BIN=/opt/homebrew/bin/node

mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$SERVER_JS</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/tmp/quickbooks-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/quickbooks-bridge.err.log</string>
</dict>
</plist>
EOF

# Stop any previous instance, then bootstrap fresh.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

sleep 1
echo "--- health check ---"
curl -s --max-time 5 http://127.0.0.1:8788/health || echo "(bridge not answering yet — check /tmp/quickbooks-bridge.err.log)"
echo
