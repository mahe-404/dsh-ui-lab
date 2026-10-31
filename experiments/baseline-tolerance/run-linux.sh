#!/usr/bin/env bash
# Issue #3 experiment: Linux side of the baseline-tolerance matrix.
#
# Produces:
#   work/base/linux                 baseline PNGs (uploaded for the other OSes)
#   work/base/*                     per-experiment baselines
#   work/logs/*.json                raw CLI output
#   work/logs/results.txt           RESULT/TOTALS/NORMALIZED lines (tab separated)
#
# Everything is written under work/ inside the throwaway CI checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
EXP="$ROOT/experiments/baseline-tolerance"
WORK="$ROOT/work"
SUMMARY="${GITHUB_STEP_SUMMARY:-$WORK/logs/step-summary.md}"

mkdir -p "$WORK/logs" "$WORK/out" "$WORK/base" "$WORK/fixtures"
: > "$WORK/logs/results.txt"

FIXTURE="$(node -e "console.log(require('node:url').pathToFileURL('test/fixtures/desktop.html').href)")"
DARK="$EXP/inject/theme-dark.css"
LIGHT="$EXP/inject/theme-light.css"

# compare <label> <cli args...>: runs the CLI, records its JSON and exit code.
# A non-zero exit is data here (changed / missing baseline), not a job failure.
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

save_baseline() {
  local label="$1"; shift
  node src/cli.mjs "$@" > "$WORK/logs/${label}.json" 2> "$WORK/logs/${label}.err"
  printf 'SAVED\t%s\t%s\n' "$label" "$?" | tee -a "$WORK/logs/results.txt"
}

# --- A. static fixture, same-machine reruns (noise control) -----------------
# Mirrors the issue usage: matrix --save-baseline, then matrix --baseline.
node src/cli.mjs matrix --surface web --profiles phone-390x844 --url "$FIXTURE" \
  --out "$WORK/out/linux-base" --save-baseline "$WORK/base/linux" --json \
  > "$WORK/logs/linux-base.json" 2> "$WORK/logs/linux-base.err"
printf 'SAVED\tlinux-base\t0\n' | tee -a "$WORK/logs/results.txt"
for i in 1 2; do
  compare "linux-static-rerun-$i" matrix --surface web --profiles phone-390x844 \
    --url "$FIXTURE" --out "$WORK/out/linux-rerun-$i" \
    --baseline "$WORK/base/linux" --diff-threshold 0 --json
done

# --- B. theme: light baseline vs dark injection, then the reverse ------------
# The fixture itself is light. --inject only changes colours, no layout.
compare "linux-theme-dark-vs-light" shot --surface web --profile phone-390x844 \
  --url "$FIXTURE" --inject "$DARK" --out "$WORK/out/linux-dark" \
  --baseline "$WORK/base/linux" --diff-threshold 0 --json
node src/cli.mjs shot --surface web --profile phone-390x844 --url "$FIXTURE" \
  --inject "$DARK" --out "$WORK/out/linux-dark-base" \
  --save-baseline "$WORK/base/theme-dark" --json \
  > "$WORK/logs/linux-theme-dark-base.json" 2> "$WORK/logs/linux-theme-dark-base.err"
compare "linux-theme-light-vs-dark" shot --surface web --profile phone-390x844 \
  --url "$FIXTURE" --inject "$LIGHT" --out "$WORK/out/linux-light" \
  --baseline "$WORK/base/theme-dark" --diff-threshold 0 --json
# Control: dark vs dark with no change should be identical.
compare "linux-theme-dark-control" shot --surface web --profile phone-390x844 \
  --url "$FIXTURE" --inject "$DARK" --out "$WORK/out/linux-dark-control" \
  --baseline "$WORK/base/theme-dark" --diff-threshold 0 --json

# --- C. dynamic content: relative time / caret / spinner / all --------------
# Reruns deliberately use different --wait values: a real repeated matrix run
# happens at an arbitrary wall-clock moment, not at the same animation phase.
node "$EXP/scripts/make-variants.mjs" "$WORK/fixtures"
MOTION_WAITS=(2500 4000 5000 6100)
for variant in reltime caret spinner all; do
  MOTION="$(node -e "console.log(require('node:url').pathToFileURL('work/fixtures/${variant}.html').href)")"
  node src/cli.mjs shot --surface web --profile phone-390x844 --url "$MOTION" \
    --out "$WORK/out/motion-${variant}-base" --save-baseline "$WORK/base/motion-${variant}" --json \
    > "$WORK/logs/motion-${variant}-base.json" 2> "$WORK/logs/motion-${variant}-base.err"
  for r in 1 2 3 4; do
    compare "motion-${variant}-rerun-$r" shot --surface web --profile phone-390x844 \
      --url "$MOTION" --out "$WORK/out/motion-${variant}-rerun-$r" \
      --wait "${MOTION_WAITS[$((r - 1))]}" \
      --baseline "$WORK/base/motion-${variant}" --diff-threshold 0 --json
  done
done

# --- D. DPR: same 390x844 viewport at 1x / 2x / 3x --------------------------
node "$EXP/scripts/use-dpr-profiles.mjs"
for d in 1 2 3; do
  node src/cli.mjs shot --surface web --profile "phone-390x844-dpr$d" --url "$FIXTURE" \
    --out "$WORK/out/dpr$d-base" --save-baseline "$WORK/base/dpr$d" --json \
    > "$WORK/logs/dpr$d-base.json" 2> "$WORK/logs/dpr$d-base.err"
  compare "dpr$d-control" shot --surface web --profile "phone-390x844-dpr$d" \
    --url "$FIXTURE" --out "$WORK/out/dpr$d-rerun" \
    --baseline "$WORK/base/dpr$d" --diff-threshold 0 --json
done
for a in 1 2 3; do
  for b in 1 2 3; do
    if [ "$a" != "$b" ]; then
      mkdir -p "$WORK/base/dpr${b}-from-dpr${a}"
      cp "$WORK/base/dpr$a/web__phone-390x844-dpr$a.png" \
         "$WORK/base/dpr${b}-from-dpr${a}/web__phone-390x844-dpr${b}.png"
      compare "dpr${b}-vs-dpr${a}" shot --surface web --profile "phone-390x844-dpr$b" \
        --url "$FIXTURE" --out "$WORK/out/dpr${b}-vs-${a}" \
        --baseline "$WORK/base/dpr${b}-from-dpr${a}" --diff-threshold 0 --json
    fi
  done
done

# --- E. normalised cross-DPR comparison -------------------------------------
# The CLI treats a screenshot-size change as changed regardless of pixels, so
# also downscale the higher-DPR capture to the lower one and count pixels with
# the tool's own tolerance (8 per channel) to separate raster noise from layout.
for pair in "2 1" "3 1" "3 2"; do
  set -- $pair
  node "$EXP/scripts/normalized-dpr-diff.mjs" \
    "$WORK/base/dpr$1/web__phone-390x844-dpr$1.png" \
    "$WORK/base/dpr$2/web__phone-390x844-dpr$2.png" 2>&1 | tee -a "$WORK/logs/results.txt"
done

{
  echo "## linux baseline + variants"
  echo '```'
  cat "$WORK/logs/results.txt"
  echo '```'
} >> "$SUMMARY"
