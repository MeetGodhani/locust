// A new conversation in a folder like .claude asks first, once, in the window (0.790).
//
//   node _tools/drive-a-settings-folder-asks-first.mjs [--packaged <Locust.exe>]
//
// The window's folder is a new, empty folder inside ~/.config: one of the folders where agents keep their own
// settings, so Locust treats it as one, and nothing of anyone's is in it. Then:
//   1. The folder chip is amber, and its hover says why.
//   2. A message sent in a new conversation does not start: the box asks, in a card over itself, and the words wait
//      in the box. (The question was a Windows dialog for one afternoon; Colin: "maybe make it part of the app?")
//   3. Start here: the folder is kept, and the same words go, as Send would send them.
//   4. A new conversation with another teammate there is not asked again.
// Spends nothing: the free model, read only, in an empty folder.

import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}

const settings = join(homedir(), '.config')
await mkdir(settings, { recursive: true })
const workspace = await mkdtemp(join(settings, 'locust-drive-caution-'))
const drive = await startDrive({
  name: 'settings-folder-asks-first',
  port: 9833,
  workspace,
  launchElsewhere: true,
  ...(packaged === undefined ? {} : { packaged }),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Code & Migrations', createdAt: '2026-10-18T00:00:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } },
      { teammateId: 'tm_iris', name: 'Iris', hue: 'violet', role: 'Research & Briefs', createdAt: '2026-10-18T00:01:00.000Z', route: { ...FREE_ROUTE, mode: 'ask' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})
await drive.ready()
const missions = async () => (await readdir(join(drive.profile, 'mission-ledger')).catch(() => [])).filter((file) => file.endsWith('.jsonl')).length
const card = `document.querySelector('.lc-folderask')?.innerText.replace(/\\s+/g, ' ') ?? ''`
const box = `document.querySelector('form.command-dock textarea')?.value ?? ''`
const MESSAGE = 'Reply with the single word ready.'
try {
  await drive.capture('the folder chip in a settings folder', async () => {
    const chip = JSON.parse(String(await drive.evaluate(`JSON.stringify({ className: document.querySelector('.lc-control--folder')?.className ?? '', title: document.querySelector('.lc-control--folder')?.title ?? '' })`)))
    check('the folder chip is amber', chip.className.includes('is-caution'), chip.className)
    check('its hover says why', chip.title.includes('This is .config, where the agents keep their own settings'), chip.title.slice(0, 160))
    return JSON.stringify(chip).slice(0, 300)
  })

  await drive.capture('sent: the box asks first', async () => {
    say(`  open: ${String(await drive.evaluate(openTeammateScript('Ash')))}`)
    const sent = await drive.evaluate(sendAndWaitScript(MESSAGE, { settle: false }))
    await drive.waitFor(`${card}.length > 0`, { timeoutMs: 60_000, what: 'the question over the box' }).catch(() => undefined)
    const asked = String(await drive.evaluate(card))
    check('the box asks, in the window', asked.startsWith('Start this conversation in locust-drive-caution-') && asked.includes('Choose another folder') && asked.includes('Start here'), asked.slice(0, 200))
    await sleep(2000)
    check('nothing started', (await missions()) === 0, `${String(await missions())} conversation(s) in the ledger`)
    check('the words wait in the box', String(await drive.evaluate(box)) === MESSAGE, JSON.stringify(await drive.evaluate(box)))
    return `${String(sent)}; ${asked.slice(0, 120)}`
  })

  await drive.capture('start here: the same words go', async () => {
    const pressed = await drive.evaluate(`(() => { const b = [...document.querySelectorAll('.lc-folderask button')].find((one) => one.innerText.trim() === 'Start here'); if (!b) return 'no Start here'; b.click(); return 'pressed' })()`)
    let started = 0
    for (let i = 0; i < 60 && started === 0; i += 1) { await sleep(500); started = await missions() }
    check('Start here starts the turn', started === 1, `${String(started)} conversation(s)`)
    check('the question is gone and the box is empty', String(await drive.evaluate(card)) === '' && String(await drive.evaluate(box)) === '', JSON.stringify({ card: await drive.evaluate(card), box: await drive.evaluate(box) }))
    const kept = JSON.parse(await readFile(join(drive.profile, 'folder-cautions.json'), 'utf8').catch(() => '{}'))
    check('and the folder is kept as said yes to', Array.isArray(kept.confirmed) && kept.confirmed.some((folder) => folder.toLowerCase() === workspace.toLowerCase()), JSON.stringify(kept))
    // The turn answers before the next conversation starts, so the two never share the free model's one slot.
    const finished = await drive.evaluate(`(async () => {
      for (let i = 0; i < 360; i += 1) {
        await new Promise((r) => setTimeout(r, 500))
        if (i > 4 && !document.querySelector('button[aria-label^="Stop the running"]')) break
      }
      return document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ').slice(-200) ?? ''
    })()`)
    return `${String(pressed)}; ${String(finished).slice(0, 160)}`
  })

  await drive.capture('another new conversation there: not asked again', async () => {
    say(`  open: ${String(await drive.evaluate(openTeammateScript('Iris')))}`)
    const sent = await drive.evaluate(sendAndWaitScript(MESSAGE, { settle: false }))
    let started = 1
    for (let i = 0; i < 40 && started < 2; i += 1) { await sleep(500); started = await missions() }
    check('no question the second time', String(await drive.evaluate(card)) === '', String(await drive.evaluate(card)).slice(0, 120))
    check('the second conversation starts at once', started === 2, `${String(started)} conversation(s)`)
    return String(sent)
  })
} finally {
  await drive.finish({ intro: 'A new conversation in a folder like .claude asks first, once, in the window (0.790).' })
  await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
}
say(failures === 0 ? 'SETTINGS FOLDER DRIVE PASSED' : `${String(failures)} SETTINGS FOLDER DRIVE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
