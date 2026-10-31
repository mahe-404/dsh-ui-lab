#!/usr/bin/env node
/**
 * Generate static fixture variants with one dynamic behaviour each, from the
 * repository's own test/fixtures/desktop.html.
 *
 * Usage: node experiments/baseline-tolerance/scripts/make-variants.mjs [outDir]
 *
 * The output is written to work/fixtures by default. Variants:
 *   reltime  - "1 h ago" text that changes every second
 *   caret    - blinking text caret (CSS animation, steps)
 *   spinner  - rotating CSS spinner
 *   all      - all three at once
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const OUT_DIR = resolve(process.argv[2] ?? join(REPO_ROOT, 'work', 'fixtures'))
const DESKTOP = join(REPO_ROOT, 'test', 'fixtures', 'desktop.html')

const base = readFileSync(DESKTOP, 'utf8')
for (const anchor of ['</style>', '</body>']) {
  if (!base.includes(anchor)) throw new Error(`fixture anchor missing: ${anchor}`)
}

// The fixture is a 960px-wide desktop shell: at a 390px phone viewport the
// whole <main> column is clipped to the right, so the dynamic zone is
// position:fixed in the bottom-left corner where the screenshot can see it.
const CSS = `#dyn-zone { position: fixed; left: 8px; top: 8px; z-index: 2147483647; margin: 0; padding: 6px 10px; border: 1px solid #c8ced6; border-radius: 8px; background: #fff; font: 13px/1.4 system-ui, sans-serif; color: #1f2328; }
#dyn-zone .dyn { margin: 0; }
#caret { display: inline-block; margin-left: 2px; animation: dyn-blink 1.2s steps(1) infinite; }
@keyframes dyn-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
#spinner { display: inline-block; width: 22px; height: 22px; vertical-align: -6px; border: 3px solid #d0d7de; border-top-color: #1f2328; border-radius: 50%; animation: dyn-spin 0.9s linear infinite; }
@keyframes dyn-spin { to { transform: rotate(360deg); } }`

// Worst-case live relative-time label: changes once per second based on the
// wall clock, so two captures taken at different wall seconds differ even when
// they settle at the same offset after load. (A real "1 h ago" label only
// changes on a minute boundary; that case is discussed in the report.)
const RELTIME_JS = `(function () {
  var labels = ['1 h ago', '59 min ago', '58 min ago', '57 min ago'];
  function tick() {
    var el = document.getElementById('reltime');
    if (el) el.textContent = labels[new Date().getSeconds() % labels.length];
  }
  tick();
  setInterval(tick, 1000);
})();`

const variants = {
  reltime: {
    html: '<div id="dyn-zone"><p class="dyn">Last activity: <strong id="reltime">1 h ago</strong></p></div>',
    js: RELTIME_JS,
  },
  caret: {
    html: '<div id="dyn-zone"><p class="dyn">Draft<span id="caret">▍</span></p></div>',
    js: '',
  },
  spinner: {
    html: '<div id="dyn-zone"><p class="dyn">Loading <span id="spinner"></span></p></div>',
    js: '',
  },
}

variants.all = {
  html: variants.reltime.html + variants.caret.html + variants.spinner.html,
  js: variants.reltime.js,
}

function build(variant) {
  let html = base.replace('</style>', `${CSS}\n</style>`)
  html = html.replace('</body>', `${variant.html}\n</body>`)
  if (variant.js.trim() !== '') html = html.replace('</body>', `<script>${variant.js}<\/script>\n</body>`)
  return html
}

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, variant] of Object.entries(variants)) {
  const target = join(OUT_DIR, `${name}.html`)
  writeFileSync(target, build(variant), 'utf8')
  console.log(`wrote ${target}`)
}
