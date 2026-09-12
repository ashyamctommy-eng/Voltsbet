#!/bin/sh
# Entry point for the settlement worker — Railway cron service, or any container
# host. Locates settle_worker.py relative to this script so it works both in the
# image (/app) and from a checkout.
#
# DEFAULT SOURCE IS `cross` (FotMob primary + 365Scores verification): keyless,
# proxyless, and the mode the shadow week was measured on. The default matters —
# falling back to `sofa` would silently require a proxy pool and fail every run.
# SETTLE_SOURCE still overrides it.
#
# Extra arguments are forwarded, so manual runs work unchanged:
#   docker run --rm <image> --dry-run --date 2026-09-11 --limit 5
set -eu

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

case " $* " in
  *" --source "*)
    exec python3 "$DIR/settle_worker.py" "$@"
    ;;
  *)
    exec python3 "$DIR/settle_worker.py" --source "${SETTLE_SOURCE:-cross}" "$@"
    ;;
esac
