#!/bin/zsh
set -euo pipefail

# 计算 Skill 根目录，保证脚本可以从任意终端目录运行。
SKILL_ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_FILE="$SKILL_ROOT/scripts/src/main.m"
PLIST_FILE="$SKILL_ROOT/assets/Info.plist"
DIST_DIR="$SKILL_ROOT/dist"
APP_BUNDLE="$DIST_DIR/CodexQuotaMenuBar.app"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-quota-menubar-build.XXXXXX")"
trap 'rm -rf "$BUILD_ROOT"' EXIT
STAGED_APP="$BUILD_ROOT/CodexQuotaMenuBar.app"
EXECUTABLE_DIR="$STAGED_APP/Contents/MacOS"
RESOURCES_DIR="$STAGED_APP/Contents/Resources"
EXECUTABLE_FILE="$EXECUTABLE_DIR/CodexQuotaMenuBar"

mkdir -p "$EXECUTABLE_DIR" "$RESOURCES_DIR"

# 使用系统 Command Line Tools 构建原生 AppKit 程序，不依赖完整 Xcode。
clang \
  -x objective-c \
  -fobjc-arc \
  -fblocks \
  -framework Cocoa \
  -framework QuartzCore \
  -mmacosx-version-min=13.0 \
  -O2 \
  -Wall \
  -Wextra \
  "$SOURCE_FILE" \
  -o "$EXECUTABLE_FILE"

cp "$PLIST_FILE" "$STAGED_APP/Contents/Info.plist"
cp "$SKILL_ROOT/assets/icon-codex-dark-color.png" "$RESOURCES_DIR/icon-codex-dark-color.png"
cp "$SKILL_ROOT/assets/icon-codex-light.png" "$RESOURCES_DIR/icon-codex-light.png"
cp "$SKILL_ROOT/assets/icon-fan.png" "$RESOURCES_DIR/icon-fan.png"

plutil -lint "$STAGED_APP/Contents/Info.plist"

# 先在系统临时目录签名，避免 Finder 或云盘目录自动附加属性干扰 codesign。
xattr -cr "$STAGED_APP"
codesign --force --deep --sign - "$STAGED_APP"
"$EXECUTABLE_FILE" --self-test

# 仅替换可重新生成的 dist App；源代码和用户数据不会被删除。
mkdir -p "$DIST_DIR"
rm -rf "$APP_BUNDLE"
ditto --norsrc "$STAGED_APP" "$APP_BUNDLE"

echo "BUILD PASS"
echo "App: $APP_BUNDLE"
echo "Live quota check: $APP_BUNDLE/Contents/MacOS/CodexQuotaMenuBar --print-quota"
echo "Start: open \"$APP_BUNDLE\""
