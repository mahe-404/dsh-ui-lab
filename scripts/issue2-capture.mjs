#!/usr/bin/env node
/**
 * Issue #2 platform capture helper (validation branch only — not part of the PR).
 *
 * Runs the documented `dsh-ui-lab` fixture commands and records the evidence the
 * upstream issue asks platform reporters to provide:
 *
 *   - `node src/cli.mjs shot` / `matrix` against `test/fixtures/desktop.html`
 *   - the produced screenshots plus their real PNG dimensions (must equal
 *     profile viewport x deviceScaleFactor — this is the "sizes match
 *     expectation" check on high-DPI hosts)
 *   - a font/rendering probe: computed font stack, `document.fonts.check()`
 *     availability and canvas text widths for the same strings, so Linux /
 *     macOS (Intel + ARM) / Windows stacks can be compared without eyeballing
 *
 * Outputs a self-describing `summary.json` in `--out-dir` for artifact upload.
 *
 * Usage: node scripts/issue2-capture.mjs --out-dir artifacts [--fixture path]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform as osPlatform, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const argv = process.argv.slice(2)
const get = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
}

const outDir = resolve(get('--out-dir', join(ROOT, 'artifacts')))
const fixture = resolve(get('--fixture', join(ROOT, 'test', 'fixtures', 'desktop.html')))
mkdirSync(outDir, { recursive: true })
const fixtureUrl = pathToFileURL(fixture).href

function readProfiles() {
  const data = JSON.parse(readFileSync(join(ROOT, 'profiles', 'profiles.json'), 'utf8'))
  return new Map(data.profiles.map(profile => [profile.id, profile]))
}

/** Minimal PNG header reader: width/height live at bytes 16..24 of IHDR. */
function pngSize(file) {
  const buffer = readFileSync(file)
  if (buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error(`not a PNG: ${file}`)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length }
}

function runCli(args, label) {
  const started = Date.now()
  let stdout
  try {
    stdout = execFileSync(process.execPath, [join(ROOT, 'src', 'cli.mjs'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (error) {
    writeFileSync(join(outDir, `${label}.error.log`), `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.stack ?? ''}`)
    throw error
  }
  const json = JSON.parse(stdout)
  writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(json, null, 2)}\n`)
  return { label, durationMs: Date.now() - started, json }
}

const profiles = readProfiles()
const results = []

results.push(
  runCli(
    ['shot', '--surface', 'web', '--profile', 'phone-390x844', '--url', fixtureUrl, '--out', join(outDir, 'fixture-shot-phone'), '--json'],
    'cli-shot-phone',
  ),
)
results.push(
  runCli(
    ['shot', '--surface', 'web', '--profile', 'tablet-768x1024', '--url', fixtureUrl, '--out', join(outDir, 'fixture-shot-tablet'), '--json'],
    'cli-shot-tablet',
  ),
)
results.push(
  runCli(
    [
      'matrix',
      '--surface',
      'web',
      '--profiles',
      'phone-390x844,tablet-768x1024',
      '--url',
      fixtureUrl,
      '--out',
      join(outDir, 'fixture-matrix'),
      '--json',
    ],
    'cli-matrix',
  ),
)

/* ---------- expected vs actual screenshot sizes ---------- */

/** Normalize the two CLI JSON shapes into [{ profileId, screenshot, metrics }]. */
function rowsFor(result) {
  if (result.label === 'cli-matrix') {
    return (result.json.results ?? []).map(row => ({
      profileId: row.id,
      screenshotPath: join(outDir, 'fixture-matrix', row.screenshot),
      metrics: {
        viewport: row.viewport,
        devicePixelRatio: row.devicePixelRatio,
        overflowX: row.overflowX,
        scrollWidth: row.scrollWidth,
        bodyClientWidth: row.bodyClientWidth,
      },
    }))
  }
  const json = result.json
  return [
    {
      profileId: json.profile.id,
      screenshotPath: json.screenshot,
      metrics: {
        viewport: json.metrics.viewport,
        layoutViewport: json.metrics.layoutViewport,
        visualViewport: json.metrics.visualViewport,
        devicePixelRatio: json.metrics.devicePixelRatio,
        overflowX: json.metrics.overflowX,
        documentElement: json.metrics.documentElement,
        body: json.metrics.body,
      },
    },
  ]
}

const sizeChecks = []
for (const result of results) {
  for (const row of rowsFor(result)) {
    if (row.screenshotPath == null) continue
    const profile = profiles.get(row.profileId)
    const actual = pngSize(row.screenshotPath)
    const fallbackViewport = row.metrics.viewport
    const expected = profile
      ? {
          width: Math.round(profile.viewport.width * profile.deviceScaleFactor),
          height: Math.round(profile.viewport.height * profile.deviceScaleFactor),
        }
      : {
          width: Math.round(fallbackViewport.width * row.metrics.devicePixelRatio),
          height: Math.round(fallbackViewport.height * row.metrics.devicePixelRatio),
        }
    sizeChecks.push({
      command: result.label,
      profile: row.profileId,
      screenshot: row.screenshotPath,
      expected,
      actual: { width: actual.width, height: actual.height, bytes: actual.bytes },
      matches: actual.width === expected.width && actual.height === expected.height,
      metrics: row.metrics,
    })
  }
}

/* ---------- font / rendering probe (same page, same viewport) ---------- */

const { chromium } = await import(join(ROOT, 'node_modules', 'playwright', 'index.mjs')).catch(() => import('playwright'))
const browser = await chromium.launch()
let fonts = null
let browserVersion = null
try {
  browserVersion = browser.version()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  await page.goto(fixtureUrl, { waitUntil: 'load', timeout: 60_000 })
  await page.waitForTimeout(600)
  fonts = await page.evaluate(() => {
    const families = [
      'system-ui',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'Helvetica Neue',
      'Arial',
      'PingFang SC',
      'Hiragino Sans GB',
      'Microsoft YaHei',
      'Noto Sans CJK SC',
      'Noto Sans SC',
      'Source Han Sans SC',
      'WenQuanYi Micro Hei',
      'sans-serif',
    ]
    const samples = {
      ascii: 'DeepSeek Harness 0123456789',
      cjk: '深色模式 · 外观与主题 · 通知',
      mixed: '设置 Settings 深色 Dark',
    }
    const canvas = document.createElement('canvas')
    const context2d = canvas.getContext('2d')
    const measure = {}
    for (const [name, text] of Object.entries(samples)) {
      measure[name] = {}
      for (const family of families) {
        context2d.font = `16px ${JSON.stringify(family)}`
        measure[name][family] = Math.round(context2d.measureText(text).width * 100) / 100
      }
      context2d.font = '16px sans-serif'
      measure[name].__flexibleSans = Math.round(context2d.measureText(text).width * 100) / 100
    }
    const bodyStyle = getComputedStyle(document.body)
    const main = document.querySelector('[data-slot="main"]')
    return {
      bodyFontFamily: bodyStyle.fontFamily,
      mainFontFamily: main === null ? null : getComputedStyle(main).fontFamily,
      htmlLang: document.documentElement.lang,
      fontCheck: Object.fromEntries(
        families.map(family => [family, document.fonts.check(`16px ${JSON.stringify(family)}`)]),
      ),
      measure,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        colorDepth: window.screen.colorDepth,
      },
      navigator: { userAgent: navigator.userAgent, language: navigator.language, hardwareConcurrency: navigator.hardwareConcurrency },
    }
  })
} finally {
  await browser.close().catch(() => {})
}

/* ---------- summary ---------- */

const summary = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  host: {
    platform: osPlatform(),
    arch: arch(),
    release: release(),
    node: process.version,
    nodeAbi: process.versions.modules,
    cpus: cpus().length,
    totalMemoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    ci: process.env.CI === 'true',
    runnerOS: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
  },
  playwright: { browserVersion },
  fixture: { path: fixture, url: fixtureUrl },
  commands: results.map(result => ({ label: result.label, durationMs: result.durationMs })),
  sizeChecks,
  allSizesMatch: sizeChecks.length > 0 && sizeChecks.every(check => check.matches),
  fonts,
}

writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
process.stdout.write(
  `platform capture: ${summary.host.platform}/${summary.host.arch}, node ${summary.host.node}, ` +
    `${sizeChecks.length} screenshot size check(s), sizes match: ${summary.allSizesMatch}\n`,
)
if (!summary.allSizesMatch) process.exitCode = 1
