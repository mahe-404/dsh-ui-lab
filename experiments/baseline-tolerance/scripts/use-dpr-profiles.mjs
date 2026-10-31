#!/usr/bin/env node
/** Swap profiles/profiles.json for the temporary DPR experiment profiles. */
import { copyFileSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const SOURCE = join(REPO_ROOT, 'experiments', 'baseline-tolerance', 'profiles', 'profiles-dpr.json')
const TARGET = join(REPO_ROOT, 'profiles', 'profiles.json')

copyFileSync(SOURCE, TARGET)
const database = JSON.parse(readFileSync(TARGET, 'utf8'))
console.log(`profiles.json swapped: ${database.profiles.map(profile => `${profile.id}@${profile.deviceScaleFactor}x`).join(', ')}`)
