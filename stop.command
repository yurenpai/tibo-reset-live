#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
/bin/sh "$ROOT/stop.sh"
STATUS=$?
[ "$STATUS" -eq 0 ] || { printf '\n停止失败，按回车关闭窗口。'; read -r _; }
exit "$STATUS"
