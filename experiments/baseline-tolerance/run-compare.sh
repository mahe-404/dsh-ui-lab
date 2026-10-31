#!/usr/bin/env bash
# Issue #3 experiment: the Windows/macOS side.
#
# 1. cross-platform: compare this OS's capture against the Ubuntu baseline
#    artifact (font rasterisation / Chromium build differences);
# 2. same-platform control: save a baseline on this OS and compare immediately
#    again, to separate platform bias from run-to-run noise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
EXP="$ROOT/experiments/baseline-tolerance"
WORK="$ROOT/work"
SUMMARY="${GITHUB_STEP_SUMMARY:-$WORK/logs/step-summary.md}"
LABEL="${LABEL:?LABEL is required}"

mkdir -p "$WORK/logs" "$WORK/out" "$WORK/base/linux" "$WORK/base/$LABEL"
: > "$WORK/logs/results.txt"

FIXTURE="$(node -e "console.log(require('node:url').pathToFileURL('test/fixtures/desktop.html').href)")"

compare() {
  local label="$1"; shift
  set +e
  node src/cli.mjs "$@" > "$WORK/logs/${label}.json" 2> "$WORK/logs/${label}.err"
  local code=$?
  set -e
  {
    printf 'EXIT\t%s\t%s\n' "$label" "$code"
    node "$EXP/scripts/summary.mjs" "$label" "$WORK/logs/${label}.json" "$code"
  } | tee -a "$WORK/logs/results.txt"
}

# --- cross-platform: Ubuntu baseline vs this runner -------------------------
if [ ! -f "$WORK/base/linux/web__phone-390x844.png" ]; then
  echo "ubuntu baseline artifact is missing at work/base/linux" >&2
  exit 1
fi
compare "${LABEL}-vs-linux" matrix --surface web --profiles phone-390x844 \
  --url "$FIXTURE" --out "$WORK/out/${LABEL}-vs-linux" \
  --baseline "$WORK/base/linux" --diff-threshold 0 --json

# --- same-platform control: own baseline, then a second run -----------------
node src/cli.mjs matrix --surface web --profiles phone-390x844 --url "$FIXTURE" \
  --out "$WORK/out/${LABEL}-base" --save-baseline "$WORK/base/$LABEL" --json \
  > "$WORK/logs/${LABEL}-base.json" 2> "$WORK/logs/${LABEL}-base.err"
printf 'SAVED\t%s-base\t0\n' "$LABEL" | tee -a "$WORK/logs/results.txt"
compare "${LABEL}-self-control" matrix --surface web --profiles phone-390x844 \
  --url "$FIXTURE" --out "$WORK/out/${LABEL}-self-control" \
  --baseline "$WORK/base/$LABEL" --diff-threshold 0 --json

{
  echo "## ${LABEL} vs ubuntu baseline"
  echo '```'
  cat "$WORK/logs/results.txt"
  echo '```'
} >> "$SUMMARY"
