#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
/bin/sh "$ROOT/scripts/start-unix.sh" "$@"
exec /bin/sh "$ROOT/scripts/autostart-unix.sh" enable
