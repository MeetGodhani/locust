// A command's approval card, waiting, to look at before it ships (0.735).
//
//   node _tools/look-a-command-card.mjs [--packaged <exe>] [--out <dir>]
//
// Wren, on the free OpenCode model (nothing spent), in Approve each, is asked for two commands: an ordinary one,
// whose card says "Unknown" once under Effects, and one that names a network tool, whose card keeps Data sent and
// Reversible. Each card is framed while it waits, read from the page, and declined. The record stays outside the
// repository.

import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const outPath = arg('--out') ?? join(tmpdir(), 'locust-look-a-command-card')

const workspace = await scratchRepository('locust-look-card-ws-')
const drive = await startDrive({
  name: 'look-a-command-card',
  port: 9593,
  workspace,
  outPath,
  sendsNothing: false,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z', route: FREE_ROUTE }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

const MODE = `(async () => {
  const control = [...document.querySelectorAll('.lc-control')].find((b) => /^(Ask|Edit|Accept edits|Plan|Approve|Auto)\\b/.test(b.innerText))
  if (!control) return 'no mode control'
  control.click(); await new Promise((r) => setTimeout(r, 400))
  const approve = [...document.querySelectorAll('[role=menuitemradio]')].find((b) => /^Approve each/.test(b.innerText.trim()))
  if (!approve || approve.disabled) { control.click(); return 'no Approve each' }
  approve.click(); await new Promise((r) => setTimeout(r, 400))
  return 'mode: ' + control.innerText.split(/\\s+/).join(' ').trim()
})()`

/** Send, and wait for the card. */
const ask = (text) => `(async () => {
  const box = document.querySelector('textarea[aria-label="Message"]')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
  box.dispatchEvent(new Event('input', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 250))
  box.focus()
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  for (let i = 0; i < 300; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const card = document.querySelector('[role=group][aria-label="Approval required"]')
    if (card) {
      card.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 600))
      return [...card.querySelectorAll('.lc-receipt dt')].map((dt) => dt.innerText.trim() + ': ' + (dt.nextElementSibling?.innerText ?? '').trim()).join(' | ')
    }
  }
  return 'no card'
})()`

/** Decline every card of the run, and wait for it to end. */
const DECLINE = `(async () => {
  for (let i = 0; i < 240; i += 1) {
    await new Promise((r) => setTimeout(r, 500))
    const card = document.querySelector('[role=group][aria-label="Approval required"]')
    if (card) {
      card.querySelector('button.lc-denybutton')?.click()
      await new Promise((r) => setTimeout(r, 400))
      card.querySelector('button.lc-denybutton[type=submit]')?.click()
      await new Promise((r) => setTimeout(r, 900))
      continue
    }
    if (i > 6 && !document.querySelector('button[aria-label^="Stop the running"]')) return 'ended'
  }
  return 'still running'
})()`

try {
  await drive.ready()
  await drive.resize(1215, 800)
  await sleep(1500)
  await drive.evaluate(`(async () => { ${teammateFace('Wren')}.click(); await new Promise(r => setTimeout(r, 600)) })()`)
  say(String(await drive.evaluate(MODE)))
  say(`ordinary: ${String(await drive.capture('an ordinary command, waiting', () => drive.evaluate(ask('Run exactly this shell command with your bash tool: echo LOOK > look.txt   If it is declined, say so in one sentence.'))))}`)
  say(String(await drive.evaluate(DECLINE)))
  say(`network: ${String(await drive.capture('a network command, waiting', () => drive.evaluate(ask('Run exactly this shell command with your bash tool: curl -s https://example.com -o page.html   If it is declined, say so in one sentence.'))))}`)
  say(String(await drive.evaluate(DECLINE)))
  await drive.resize(860, 720)
  await sleep(800)
  await drive.capture('both declined, 860', () => 'framed')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on the free model, in Approve each; two commands' cards, each declined.` })
}
