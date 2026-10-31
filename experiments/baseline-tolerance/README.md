# baseline-tolerance experiments (issue #3)

Temporary, throwaway assets for
[LUgABeEEE/dsh-ui-lab#3](https://github.com/LUgABeEEE/dsh-ui-lab/issues/3):
how far `--baseline` diff% moves across OS, DPR, theme and dynamic content.

Nothing here is intended for upstream. The branch `exp/baseline-tolerance` on
`mahe-404/dsh-ui-lab` exists only to run the workflow.

## Files

| path | purpose |
| --- | --- |
| `.github/workflows/baseline-tolerance.yml` | ubuntu baseline + windows/macos-13/macos-14 comparison jobs |
| `run-linux.sh` | Linux capture matrix: static reruns, theme, motion variants, DPR |
| `run-compare.sh` | Windows/macOS: cross-platform diff vs Ubuntu baseline, plus own-baseline control |
| `scripts/summary.mjs` | flattens `shot`/`matrix` JSON into `RESULT` lines |
| `scripts/make-variants.mjs` | generates reltime / caret / spinner / all fixtures from `test/fixtures/desktop.html` |
| `scripts/use-dpr-profiles.mjs` | swaps `profiles/profiles.json` for the temporary DPR set (CI workspace only) |
| `scripts/normalized-dpr-diff.mjs` | downscales a higher-DPR capture and diffs it against the lower one |
| `inject/theme-dark.css`, `inject/theme-light.css` | colour-only theme switch via `--inject` |
| `profiles/profiles-dpr.json` | 390×844 at DPR 1/2/3, same UA/flags |

## Reproduce locally

```bash
cp -r dsh-ui-lab /tmp/lab-experiment && cd /tmp/lab-experiment
bash experiments/baseline-tolerance/run-linux.sh   # needs Playwright + Chromium
# inspect work/logs/results.txt
```

The CI run uses the same scripts, so the numbers in
`work/baseline-tolerance/` can be re-derived from the run links recorded there.
