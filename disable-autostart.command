#!/bin/sh
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
/bin/sh "$ROOT/disable-autostart.sh"
STATUS=$?
[ "$STATUS" -eq 0 ] || { printf '\n操作失败，按回车关闭窗口。'; read -r _; }
exit "$STATUS"
