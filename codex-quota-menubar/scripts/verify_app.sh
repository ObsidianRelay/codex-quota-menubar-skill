#!/bin/zsh
set -euo pipefail

SKILL_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
APP_BUNDLE="$SKILL_ROOT/dist/CodexQuotaMenuBar.app"
VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-quota-menubar-verify.XXXXXX")"
trap 'rm -rf "$VERIFY_ROOT"' EXIT
VERIFY_APP="$VERIFY_ROOT/CodexQuotaMenuBar.app"

# 在无云盘元数据干扰的临时目录复核真实 App 内容和签名。
ditto --norsrc "$APP_BUNDLE" "$VERIFY_APP"
xattr -cr "$VERIFY_APP"
EXECUTABLE_FILE="$VERIFY_APP/Contents/MacOS/CodexQuotaMenuBar"

test -x "$EXECUTABLE_FILE"
plutil -lint "$VERIFY_APP/Contents/Info.plist"
codesign --verify --deep --strict "$VERIFY_APP"
"$EXECUTABLE_FILE" --self-test
"$EXECUTABLE_FILE" --print-system
"$EXECUTABLE_FILE" --print-quota

echo "VERIFY PASS"
