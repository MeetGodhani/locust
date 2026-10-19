// Does Antigravity ask with Locust's decision card? (0.801)
//
//   LOCUST_SPEND=1 node _tools/probe-antigravity-asks-with-the-card.mjs [--packaged <exe>]
//
// Antigravity runs through its CLI (`agy -p`) wherever the CLI is installed, and the CLI skips the agent's own
// `ask_question` the moment it is called (agy 1.4.2, measured 2026-10-19: "A1: User Skipped" 0.1s after the call;
// its changelog: "Headless -p runs skip these questions"). Asked to use "your multiple-choice question tool", the
// model then told a person who was never asked "You chose to skip selecting an option". Asked in plain words, it
// uses the brief's block instead: 3 of 3 on 2026-10-19, Gemini 3.8 Flash. This keeps that true: it asks something
// that cannot be settled alone, in plain words, and reads what came back -- a decision card, or a skipped question.

import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { pickRouteScript, say, sleep, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_SPEND !== '1') {
  say('needs LOCUST_SPEND=1: one Antigravity Flash turn')
  process.exit(2)
}
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'antigravity-asks-with-the-card',
  port: 9645,
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
  // Neutral words: nothing here names a tool or the block, so what it reaches for is its own choice.
  await drive.evaluate(`(async () => {
    const field = document.querySelector('form.command-dock textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'I am naming a new side project and have three names in mind: Kestrel, Juniper and Basalt. Ask me which one to use. Do not pick one yourself, read nothing, and change no files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 300))
    field.form.requestSubmit()
  })()`)
  let seen = { card: false, ended: false, tail: '' }
  for (let second = 0; second < 150 && !seen.card && !seen.ended; second += 2) {
    await sleep(2000)
    seen = JSON.parse(String(await drive.evaluate(`JSON.stringify({
      card: !!document.querySelector('.lc-decision .lc-decision__option'),
      ended: !document.querySelector('button[aria-label^="Stop the running"]') && /no files changed|files? changed|failed/i.test(document.querySelector('main')?.innerText ?? ''),
      tail: (document.querySelector('main')?.innerText ?? '').replace(/\\s+/g, ' ').slice(-500)
    })`)))
  }
  await drive.capture('what came back', () => Promise.resolve(seen.tail))
  say(`the reply: ${seen.tail}`)
  // This drive's own conversation, from its own ledger: what agy recorded for the turn.
  const ledger = join(drive.profile, 'mission-ledger')
  const text = (await Promise.all((await readdir(ledger).catch(() => [])).map((name) => readFile(join(ledger, name), 'utf8').catch(() => '')))).join('\n')
  const conversation = /"runtimeThreadId":"([0-9a-f-]{36})"/.exec(text)?.[1]
  const steps = conversation === undefined ? [] : (await readFile(join(homedir(), '.gemini', 'antigravity-cli', 'brain', conversation, '.system_generated', 'logs', 'transcript.jsonl'), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean)
  for (const line of steps.slice(1)) {
    try {
      const record = JSON.parse(line)
      say(`  step ${String(record.step_index)} ${String(record.type)}: ${String(record.content ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
    } catch {}
  }
  const skipped = /skip/i.test(seen.tail)
  say(`card: ${String(seen.card)} || said skipped: ${String(skipped)}`)
  say(seen.card && !skipped ? 'PASS: Antigravity asked with the decision card' : 'FAIL: no decision card')
  code = seen.card && !skipped ? 0 : 1
  await drive.evaluate(`document.querySelector('button[aria-label^="Stop the running"]')?.click()`)
  await sleep(1500)
} catch (error) {
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'One Antigravity Flash turn asked to offer a choice; did the decision card come back?' })
}
process.exit(code)
