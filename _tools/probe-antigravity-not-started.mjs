// Does a turn Antigravity takes but never starts say so at a minute? (0.800)
//
//   LOCUST_SPEND=1 node _tools/probe-antigravity-not-started.mjs [--packaged <exe>]
//
// For a machine where Antigravity is open but its agent is not running (2026-10-19: its window had crashed, and
// four turns sat "running" 150s each with no word until the ten-minute ending). Sends one short Flash turn in the
// folder Antigravity has open and reads the thread at 75s. If Antigravity is working, the turn runs and spends a
// little, so it needs LOCUST_SPEND=1; then the note must NOT appear.

import { homedir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, sleep, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('needs LOCUST_SPEND=1: a working Antigravity runs the turn')
  process.exit(2)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'antigravity-not-started',
  port: 9644,
  // The folder Antigravity already has open, as drive-antigravity-answer uses: it refuses any other.
  workspace: join(homedir(), 'Documents', 'antigravtest').replace(/\\/g, '/'),
  spends: true,
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_gem', name: 'Gem', hue: 'blue', role: 'Custom', avatar: { headwear: 0, accessory: 0, mouth: 0, bot: { shape: 'droid', face: 'eyes' } }, createdAt: '2026-10-19T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
let code = 1
try {
  await drive.ready()
  await drive.evaluate(`(async () => {
    ;[...document.querySelectorAll('button')].find((b) => /Gem/.test((b.getAttribute('title') ?? '') + ' ' + (b.getAttribute('aria-label') ?? '') + ' ' + b.innerText))?.click()
    await new Promise((r) => setTimeout(r, 800))
  })()`)
  say(await drive.evaluate(pickRouteScript({ group: '/antigravity/i', search: 'flash', row: '/flash/i' })))
  const route = await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`)
  if (!/antigravity/i.test(route) || !/flash/i.test(route)) throw new Error(`refusing to send: the composer is on "${route}"`)
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Reply with the single word READY. Change no files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
  })()`)
  await sleep(75_000)
  const thread = String(await drive.capture('the thread at 75s', () => drive.evaluate(`document.querySelector('main')?.innerText.replace(/\\s+/g, ' ').slice(-1200) ?? ''`)))
  const noted = /has not started it/i.test(thread)
  const answered = /READY/.test(thread.replace(/Reply with the single word READY/g, ''))
  say(`noted: ${String(noted)} || answered: ${String(answered)}`)
  say(noted && !answered ? 'PASS: the turn that never started said so' : answered && !noted ? 'PASS (control): Antigravity is working, and no note' : 'FAIL')
  code = (noted !== answered) ? 0 : 1
  // End it either way: nothing should be left running in Antigravity's folder.
  await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]')?.click()`)
  await sleep(1500)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One Antigravity Flash turn; the thread read at 75s for the not-started note.' })
}
process.exit(code)
