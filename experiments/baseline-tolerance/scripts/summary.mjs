#!/usr/bin/env node
/**
 * Turn one CLI --json output file into machine-readable RESULT/TOTALS lines.
 * Works for both `shot` results (with .baseline) and `matrix` summaries (with
 * .results[] rows that carry a .baseline object).
 *
 * Usage: node summary.mjs <label> <jsonFile> [exitCode]
 * Output: tab-separated lines on stdout; exit status 0 even for changed runs.
 */
import { readFileSync } from 'node:fs'

const [label, file, exitCode] = process.argv.slice(2)
if (!label || !file) {
  console.error('usage: summary.mjs <label> <jsonFile> [exitCode]')
  process.exit(2)
}

let data
try {
  data = JSON.parse(readFileSync(file, 'utf8'))
} catch (error) {
  console.log(['RESULT', label, 'unparsable', '-', '', '', '', `exit=${exitCode ?? ''}`].join('\t'))
  console.error(`cannot parse ${file}: ${error.message}`)
  process.exit(0)
}

const rows = Array.isArray(data?.results) ? data.results : [data]
for (const row of rows) {
  const id = row?.profile?.id ?? row?.id ?? '?'
  const baseline = row?.baseline ?? null
  const status = baseline?.status ?? 'none'
  const diffPct = baseline?.diffPct ?? ''
  const diffPixels = baseline?.diffPixels ?? ''
  const totalPixels = baseline?.totalPixels ?? ''
  console.log(['RESULT', label, id, status, diffPct, diffPixels, totalPixels, `exit=${exitCode ?? ''}`].join('\t'))
}
if (data?.totals) console.log(['TOTALS', label, JSON.stringify(data.totals), `exit=${exitCode ?? ''}`].join('\t'))
