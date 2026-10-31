#!/usr/bin/env node
/**
 * Normalised cross-DPR comparison.
 *
 * `--baseline` treats a screenshot-size change as changed no matter what the
 * pixels are, so a 1x baseline can never match a 2x/3x capture. To answer
 * "does the same CSS layout render stably across DPRs", downscale the first
 * image to the second image's dimensions in a canvas and count pixels whose
 * R/G/B/A channel differs by more than 8 (the tool's own CHANNEL_TOLERANCE).
 *
 * Usage: node normalized-dpr-diff.mjs <a.png> <b.png>
 * Prints one NORMALIZED line: diffPct relative to the smaller image area.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolvePlaywright } from '../../../src/playwright.mjs'

const [aPath, bPath] = process.argv.slice(2)
if (!aPath || !bPath) {
  console.error('usage: normalized-dpr-diff.mjs <a.png> <b.png>')
  process.exit(2)
}

const TOLERANCE = 8
const playwright = resolvePlaywright({
  explicit: process.env.DSH_UI_LAB_PLAYWRIGHT ?? null,
  dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
})
const browser = await playwright.chromium.launch()
try {
  const page = await browser.newPage()
  const a = readFileSync(aPath).toString('base64')
  const b = readFileSync(bPath).toString('base64')
  const result = await page.evaluate(
    async ({ a, b, tolerance }) => {
      const load = data =>
        new Promise((resolveImage, reject) => {
          const image = new Image()
          image.onload = () => resolveImage(image)
          image.onerror = () => reject(new Error('cannot decode screenshot'))
          image.src = `data:image/png;base64,${data}`
        })
      const [left, right] = await Promise.all([load(a), load(b)])
      const width = left.naturalWidth
      const height = left.naturalHeight
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(left, 0, 0, width, height)
      const leftData = context.getImageData(0, 0, width, height).data
      context.clearRect(0, 0, width, height)
      context.drawImage(right, 0, 0, width, height)
      const rightData = context.getImageData(0, 0, width, height).data
      let diffPixels = 0
      for (let index = 0; index < leftData.length; index += 4) {
        if (
          Math.abs(leftData[index] - rightData[index]) > tolerance ||
          Math.abs(leftData[index + 1] - rightData[index + 1]) > tolerance ||
          Math.abs(leftData[index + 2] - rightData[index + 2]) > tolerance ||
          Math.abs(leftData[index + 3] - rightData[index + 3]) > tolerance
        ) {
          diffPixels += 1
        }
      }
      return { diffPixels, totalPixels: width * height, source: { width: left.naturalWidth, height: left.naturalHeight }, target: { width: right.naturalWidth, height: right.naturalHeight } }
    },
    { a, b, tolerance: TOLERANCE },
  )
  const diffPct = result.totalPixels === 0 ? 0 : (result.diffPixels / result.totalPixels) * 100
  console.log(
    [
      'NORMALIZED',
      aPath.split(/[\\/]/).slice(-3).join('/'),
      'vs',
      bPath.split(/[\\/]/).slice(-3).join('/'),
      `diffPct=${Math.round(diffPct * 100) / 100}`,
      `diffPixels=${result.diffPixels}`,
      `totalPixels=${result.totalPixels}`,
      `canvas=${result.source.width}x${result.source.height}`,
      `scaledFrom=${result.target.width}x${result.target.height}`,
    ].join('\t'),
  )
} finally {
  await browser.close()
}
