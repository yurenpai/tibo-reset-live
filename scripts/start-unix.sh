#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
RUNTIME="$ROOT/.runtime"
mkdir -p "$RUNTIME"

# Finder / launchd 不读取交互式终端配置；照顾系统安装与 Homebrew 的常用位置。
PATH="${PATH:-/usr/bin:/bin}:/opt/homebrew/bin:/usr/local/bin"
export PATH
if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>=26||(a===24&&b>=15)?0:1)' ; then
  printf '%s\n' '需要 Node.js 24.15+（24 LTS）或 26+。请先从 https://nodejs.org 安装支持的版本。' >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' '没有找到 npm，请重新安装完整的 Node.js LTS。' >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  LOCK_HASH=$(shasum -a 256 "$ROOT/package-lock.json" | awk '{print $1}')
else
  LOCK_HASH=$(sha256sum "$ROOT/package-lock.json" | awk '{print $1}')
fi
HASH_FILE="$RUNTIME/dependencies.sha256"
OLD_HASH=''
[ -f "$HASH_FILE" ] && OLD_HASH=$(cat "$HASH_FILE")
if [ ! -f "$ROOT/node_modules/node-notifier/package.json" ] || [ "$LOCK_HASH" != "$OLD_HASH" ]; then
  printf '%s\n' '首次启动或依赖已更新，正在安装项目依赖……'
  (cd "$ROOT" && npm ci --omit=dev --ignore-scripts)
  printf '%s' "$LOCK_HASH" > "$HASH_FILE"
fi

exec node "$ROOT/scripts/local-control.mjs" start "$@"
