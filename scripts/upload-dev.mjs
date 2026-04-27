#!/usr/bin/env node
// Upload an .ehpk to https://hub.evenrealities.com/hub/<package_id>.
// Reuses .hub-portal-session.json from inspect-hub.mjs (run that first
// to log in once).
//
// Generic by design — reads `package_id` from ./app.json and the .ehpk
// path from the first .ehpk in repo root (or --file). Same script works
// for Cue, Pulse, Glance, lyrics-glow, etc.
//
// Usage:
//   node scripts/upload-dev.mjs                 # uploads ./<one>.ehpk
//   node scripts/upload-dev.mjs path/to/x.ehpk  # explicit file
//   node scripts/upload-dev.mjs --headless      # CI-friendly (after first login)
//
// Selectors verified against the dev portal at hub.evenrealities.com on
// 2026-04-26 via scripts/inspect-hub-project.mjs. Update the SELECTOR
// comments if the SPA's DOM changes.

import { chromium } from 'playwright-core'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HUB_BASE = 'https://hub.evenrealities.com/hub'
// Shared across repos — see inspect-hub.mjs for rationale.
const STORAGE_STATE = `${process.env.HOME}/.hub-portal-session.json`
const APP_JSON = 'app.json'
const FAILURE_DUMP = '.upload-dev-failure.html'

if (!existsSync(APP_JSON)) {
  console.error(`✗ ${APP_JSON} not found — run from your app's repo root.`)
  process.exit(1)
}
const appJson = JSON.parse(readFileSync(APP_JSON, 'utf-8'))
const packageId = appJson.package_id
const appVersion = appJson.version
if (!packageId) {
  console.error(`✗ ${APP_JSON} has no package_id.`)
  process.exit(1)
}

const args = process.argv.slice(2)
const headless = args.includes('--headless')
const ehpkArg = args.find(a => a.endsWith('.ehpk'))
const ehpkPath = ehpkArg
  ? resolve(ehpkArg)
  : resolve(readdirSync('.').find(f => f.endsWith('.ehpk')) ?? 'unknown.ehpk')

if (!existsSync(ehpkPath)) {
  console.error(`✗ .ehpk not found: ${ehpkPath}`)
  console.error('  Run `npm run deploy` first, or pass an explicit path.')
  process.exit(1)
}

if (!existsSync(STORAGE_STATE)) {
  console.error(`✗ No saved session at ${STORAGE_STATE}.`)
  console.error('  Run scripts/inspect-hub.mjs once to log in and save the session.')
  process.exit(2)
}

async function dumpFailure(page, where, err) {
  try {
    const html = await page.content()
    writeFileSync(FAILURE_DUMP, `<!-- failed at: ${where} -->\n<!-- error: ${err?.message ?? err} -->\n${html}`)
    console.error(`  page HTML dumped to ${FAILURE_DUMP}`)
  } catch { /* ignore */ }
}

async function main() {
  console.log(`→ App      ${packageId} v${appVersion}`)
  console.log(`  File     ${ehpkPath}`)
  console.log(`  Mode     ${headless ? 'headless' : 'headed'}`)

  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({ storageState: STORAGE_STATE })
  const page = await context.newPage()
  page.setDefaultTimeout(15_000)

  const projectUrl = `${HUB_BASE}/${packageId}`
  await page.goto(projectUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1_500)

  if (!page.url().includes(packageId)) {
    console.error(`✗ Could not navigate to ${projectUrl} — landed at ${page.url()}.`)
    console.error('  Check that the project exists in the dev portal.')
    await browser.close()
    process.exit(3)
  }

  // SELECTOR: top-right "Upload a build" button on the project detail page.
  // Distinct from "Upload package" on the list page (different copy).
  try {
    const uploadBtn = page.locator('button:has-text("Upload a build")').first()
    await uploadBtn.waitFor({ state: 'visible', timeout: 10_000 })
    await uploadBtn.click()
  } catch (err) {
    console.error('✗ Could not find "Upload a build" button.')
    await dumpFailure(page, 'upload-trigger', err)
    await browser.close()
    process.exit(4)
  }

  // SELECTOR: dialog containing the file input + drop zone.
  try {
    await page.waitForSelector('[role="dialog"][data-state="open"]', { timeout: 8_000 })
  } catch (err) {
    console.error('✗ Upload dialog did not open.')
    await dumpFailure(page, 'dialog-open', err)
    await browser.close()
    process.exit(5)
  }

  // SELECTOR: hidden <input type="file" accept=".ehpk"> inside the dialog.
  // Playwright can set files on a hidden input directly — no need to click
  // "Select file" (which would open the native OS file picker).
  try {
    const fileInput = page.locator('[role="dialog"] input[type="file"][accept=".ehpk"]').first()
    await fileInput.waitFor({ state: 'attached', timeout: 5_000 })
    await fileInput.setInputFiles(ehpkPath)
    console.log('  File set on hidden input.')
  } catch (err) {
    console.error('✗ Could not set file on hidden input.')
    await dumpFailure(page, 'set-file', err)
    await browser.close()
    process.exit(6)
  }

  // After setting the file, the dialog typically transitions from "drop
  // zone" to a confirm/upload state. Wait briefly + capture what surfaced.
  await page.waitForTimeout(2_000)
  writeFileSync('.upload-dev-after-file.html', await page.content())

  // Look for a confirm button. Try a sequence of likely texts.
  const confirmCandidates = [
    'button:has-text("Upload")',
    'button:has-text("Create build")',
    'button:has-text("Submit")',
    'button:has-text("Confirm")',
    'button:has-text("Save")',
  ]
  let confirmClicked = false
  for (const sel of confirmCandidates) {
    // Need the LAST matching button — there may be a stale "Upload a build"
    // trigger elsewhere on the page. The active dialog button is rendered
    // on top.
    const btn = page.locator(`[role="dialog"] ${sel}`).last()
    if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      const text = (await btn.textContent())?.trim()
      console.log(`  Clicking confirm: ${sel} (text: ${JSON.stringify(text)})`)
      await btn.click()
      confirmClicked = true
      break
    }
  }
  if (!confirmClicked) {
    console.log('  No explicit confirm button surfaced — file may have auto-uploaded.')
  }

  // Wait up to 60s for an upload-success indicator (toast, version-list
  // refresh, dialog close, etc.). Multi-signal accept since we don't
  // know the exact pattern yet.
  let uploaded = false
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(2_000)
    // Heuristic 1: dialog has closed.
    const dialogStillOpen = await page.locator('[role="dialog"][data-state="open"]').count()
    if (dialogStillOpen === 0) {
      uploaded = true
      console.log('  Dialog closed — upload likely succeeded.')
      break
    }
    // Heuristic 2: the dialog now shows our just-uploaded version string.
    const versionMatch = await page.locator(`[role="dialog"]:has-text("${appVersion}")`).count()
    if (versionMatch > 0) {
      uploaded = true
      console.log(`  Dialog shows v${appVersion} — upload likely succeeded.`)
      break
    }
    // Heuristic 3: success toast.
    const toast = await page.locator('text=/uploaded|success|created/i').count()
    if (toast > 0) {
      uploaded = true
      console.log('  Success toast surfaced.')
      break
    }
  }
  if (!uploaded) {
    console.warn('  No success indicator within 60s — capturing state for inspection.')
    writeFileSync('.upload-dev-final.html', await page.content())
  }

  // Look for an "Accept" / "Activate" / "Publish" step that may appear
  // post-upload (the user's flow described "click upload, then accept").
  const acceptCandidates = [
    'button:has-text("Accept")',
    'button:has-text("Activate")',
    'button:has-text("Publish")',
    'button:has-text("Approve")',
    'button:has-text("Confirm build")',
  ]
  for (const sel of acceptCandidates) {
    const btn = page.locator(sel).first()
    if (await btn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      console.log(`  Found accept: ${sel}`)
      await btn.click()
      break
    }
  }

  console.log(`✓ Upload flow finished for ${packageId} v${appVersion}. Verify in the portal.`)
  await context.storageState({ path: STORAGE_STATE })
  await browser.close()
}

main().catch(err => {
  console.error('✗ Upload failed:', err.message)
  process.exit(1)
})
