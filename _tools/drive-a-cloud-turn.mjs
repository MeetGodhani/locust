// A teammate's turn on YOUR CLOUD COMPUTER (0.761), the way a person meets it: Cloud picked in the chat-type menu for
// an OpenCode teammate, the first-time dialog (what it is, what it costs) set up, a task sent, the change shown and
// brought home, a second turn in the same conversation, and Settings > Cloud computers.
//
//   node _tools/drive-a-cloud-turn.mjs [--packaged <exe>] [--fresh] [--keep]
//
// Spends nothing: a free OpenCode model, and GitHub's free codespace hours (2 CPUs, a few minutes). It works on the
// throwaway repository made for Codex Cloud on 09-30 (automatedworkflowllc-design/locust-cloud-test), never one of
// Colin's own. `--fresh` deletes Locust's cloud computer for it first, so the dialog makes one; `--keep` leaves the
// one the drive used (it stops itself after 10 quiet minutes either way).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const REPO = 'automatedworkflowllc-design/locust-cloud-test'
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const fresh = process.argv.includes('--fresh')
const keep = process.argv.includes('--keep')
const gh = (args) => new Promise((resolve) => {
  execFile('gh', args, { windowsHide: true, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }))
})
const oursOn = async () => {
  const listed = await gh(['codespace', 'list', '--repo', REPO, '--json', 'name,displayName,state'])
  return listed.code === 0 ? JSON.parse(listed.stdout || '[]').filter((space) => space.displayName === 'locust-locust-cloud-test') : []
}

if (fresh) {
  for (const space of await oursOn()) {
    const gone = await gh(['codespace', 'delete', '-c', space.name, '--force'])
    say(`deleted ${space.name} first: exit ${String(gone.code)}`)
  }
}

// A clone of the test repository with a line written here and not committed: the cloud copy must carry it.
const root = await mkdtemp(join(tmpdir(), 'locust-drive-cloud-turn-ws-'))
const workspace = join(root, 'locust-cloud-test')
const cloned = await gh(['repo', 'clone', REPO, workspace])
if (cloned.code !== 0) throw new Error(`clone failed: ${cloned.stderr}`)
const readme = await readFile(join(workspace, 'README.md'), 'utf8')
const HERE_LINE = 'A line written on this computer and never committed: kiwi-lantern.'
await writeFile(join(workspace, 'README.md'), `${readme.trimEnd()}\n\n${HERE_LINE}\n`, 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-cloud-turn',
  port: 9643,
  workspace,
  outPath: join(recordRoot('a-cloud-turn-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'blue', role: 'Code & Migrations', createdAt: '2026-10-12T19:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/space-bunny-free', mode: 'accept-edits' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
const text = (selector) => drive.evaluate(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)
const click = (selector, words) => drive.evaluate(`(() => {
  const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((one) => one.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(words)}))
  if (!found) return 'no ' + ${JSON.stringify(words)}
  found.click()
  return 'clicked'
})()`)
/** Polls the page until `test` (an expression) is truthy, or the time is up. */
const until = async (expression, seconds) => {
  for (let index = 0; index < seconds; index += 1) {
    if (await drive.evaluate(`Boolean(${expression})`)) return true
    await sleep(1000)
  }
  return false
}
/** Sends, then waits from here for the turn to end: a cloud turn's first minute is its computer being readied. */
const sendAndWait = async (words, seconds) => {
  say(`  send: ${String(await drive.evaluate(sendAndWaitScript(words, { settle: false })))}`)
  await sleep(4000)
  const ended = await until(`!document.querySelector('button[aria-label^="Stop the running"]')`, seconds)
  await sleep(1500)
  return ended
}

try {
  await drive.ready()
  await drive.resize(1215, 860)
  say(`open Wren: ${String(await drive.evaluate(openTeammateScript('Wren')))}`)
  await sleep(800)

  // Cloud, in the chat-type menu, for an OpenCode teammate.
  say(`  chip: ${String(await drive.evaluate(`(() => { const chip = document.querySelector('.lc-control--chatmode'); if (!chip) return 'no chip'; chip.click(); return 'opened' })()`))}`)
  await sleep(500)
  const menu = String(await drive.capture('the chat-type menu, Cloud offered for an OpenCode teammate', () => text('.lc-menu[aria-label="Direct or compare"]')))
  check('Cloud is offered for an OpenCode teammate, as your own cloud computer', /Cloud Runs on your cloud computer, a GitHub Codespace/.test(menu), menu)
  say(`  pick Cloud: ${String(await click('.lc-menu__item', 'Cloud'))}`)

  // The first time for this repository: the dialog, what it costs, then each step.
  const asked = await until(`document.querySelector('.lc-cloudsetup')`, 30)
  if (asked) {
    const dialog = String(await drive.capture('the first time: what it is and what it costs', () => text('.lc-cloudsetup')))
    check('the dialog says what it costs before anything is made', /60 hours, from GitHub/.test(dialog) && /\$0\.18 an hour/.test(dialog) && /Set it up/.test(dialog), dialog)
    say(`  set it up: ${String(await click('.lc-cloudsetup button', 'Set it up'))}`)
    await sleep(2500)
    await drive.capture('setting it up, step by step', () => text('.lc-cloudsetup'))
    const ready = await until(`/Ready\\. Send/.test(document.querySelector('.lc-cloudsetup')?.innerText ?? '')`, 300)
    const done = String(await drive.capture('ready', () => text('.lc-cloudsetup')))
    check('it set the cloud computer up and says it is ready', ready, done)
    say(`  done: ${String(await click('.lc-cloudsetup button', 'Done'))}`)
    await sleep(600)
  } else {
    check('this repository already had its cloud computer (run with --fresh to see the dialog)', true)
  }
  const placeholder = String(await drive.evaluate(`document.querySelector('form.command-dock textarea')?.getAttribute('placeholder') ?? ''`))
  check('the box says where the task goes', /your cloud computer/.test(placeholder), placeholder)

  // A turn there: the folder as it is here, the change kept there.
  const first = await sendAndWait('Read README.md and quote its last line exactly. Then add a file named greeting.txt holding the single line: hello from the cloud. Change no other file.', 360)
  const thread = String(await drive.capture('the turn, run on the cloud computer', () => text('.lc-thread')))
  check('the turn ended', first, thread.slice(-200))
  const marker = String(await text('.lc-cloudmarker'))
  check('the thread says where it ran', /On your cloud computer/.test(marker) && /locust-cloud-test · main · 2 CPUs, 8 GB/.test(marker), marker)
  check('it read this folder as it is here, the uncommitted line included', /kiwi-lantern/.test(thread), thread.slice(-400))
  // Its change is read from the cloud computer once the turn ends: a few seconds, said on the thread meanwhile.
  await until(`/The change is on your cloud computer/.test(document.querySelector('.lc-cloudchange')?.innerText ?? '')`, 60)
  const card = String(await drive.capture('its change, waiting there', () => text('.lc-cloudchange')))
  check('its change waits on the cloud computer', /The change is on your cloud computer/.test(card) && /greeting\.txt/.test(card) && /not here yet/.test(card), card)
  check('nothing came here before Apply', !(await readFile(join(workspace, 'greeting.txt'), 'utf8').then(() => true, () => false)))

  say(`  show: ${String(await click('.lc-cloudchange button', 'Show the change'))}`)
  const shown = await until(`/hello from the cloud/.test(document.querySelector('.lc-cloudchange .lc-review__files')?.innerText ?? '')`, 60)
  await drive.capture('the change, shown', () => text('.lc-cloudchange'))
  check('Show the change reads it from the cloud computer', shown)

  say(`  apply: ${String(await click('.lc-cloudchange button', 'Apply to this folder'))}`)
  const home = await until(`/Brought into this folder/.test(document.querySelector('.lc-thread')?.innerText ?? '')`, 90)
  await drive.capture('brought home', () => text('.lc-thread'))
  const greeting = await readFile(join(workspace, 'greeting.txt'), 'utf8').catch(() => '')
  const readmeNow = await readFile(join(workspace, 'README.md'), 'utf8')
  check('Apply brought it into this folder', home && /hello from the cloud/.test(greeting), greeting)
  check("and left the person's own uncommitted edit as it was", readmeNow.includes(HERE_LINE))

  // The next turn carries on in the same copy, and its change is only what is new.
  const second = await sendAndWait('Append a second line to greeting.txt: goodbye from the cloud. Change no other file.', 300)
  const thread2 = String(await drive.capture('a second turn, in the same copy', () => text('.lc-thread')))
  check('the second turn ended', second, thread2.slice(-200))
  check('a cloud turn never says "no files changed" over a change that is waiting there', !/no files changed/.test(thread2), (thread2.match(/.{0,80}no files changed/) ?? [''])[0])
  // The SECOND turn's own card: the first one's, brought home, also says "1 file", so it is the last card, waiting there.
  await until(`(() => { const cards = [...document.querySelectorAll('.lc-cloudchange')]; return cards.length >= 2 && /not here yet/.test(cards.at(-1)?.innerText ?? '') })()`, 90)
  const cards = String(await drive.evaluate(`[...document.querySelectorAll('.lc-cloudchange')].map((one) => one.innerText.replace(/\\s+/g, ' ').trim()).join(' || ')`))
  const latest = cards.split(' || ').at(-1) ?? ''
  check('and the first card says it was brought home', /^Brought into this folder/.test(cards.split(' || ')[0] ?? ''), cards)
  // Only what is new: greeting.txt changed since it came home, never added again (as it would read from the copy's first
  // starting point). The model may append or rewrite the file, so the line counts are not the test -- what it is, is.
  say(`  show the second: ${String(await drive.evaluate(`(() => { const card = [...document.querySelectorAll('.lc-cloudchange')].at(-1); const show = [...(card?.querySelectorAll('button') ?? [])].find((one) => one.innerText.includes('Show the change')); if (!show) return 'no button'; show.click(); return 'clicked' })()`))}`)
  await until(`/goodbye from the cloud/.test([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.querySelector('.lc-review__files')?.innerText ?? '')`, 60)
  const secondShown = String(await drive.capture("the second turn's change, shown", () => drive.evaluate(`([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.querySelector('.lc-review__files')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  check("the second turn's change is only what is new", /^The change is on your cloud computer 1 file/.test(latest) && /greeting\.txt/.test(secondShown) && /goodbye from the cloud/.test(secondShown) && !/greeting\.txt added/i.test(secondShown), `${latest} :: ${secondShown.slice(0, 300)}`)

  // Settings > Cloud computers.
  say(`  settings: ${String(await drive.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((one) => one.innerText.trim() === 'Settings'); if (!button) return 'no settings'; button.click(); return 'opened' })()`))}`)
  await sleep(800)
  say(`  page: ${String(await click('.lc-settings__navitem', 'Cloud computers'))}`)
  const listed = await until(`document.querySelector('.lc-cloudcomputer')`, 30)
  const settings = String(await drive.capture('Settings > Cloud computers', () => text('.lc-settings__pane')))
  check('Settings lists the cloud computer, and what it is doing', listed && /locust-cloud-test/.test(settings) && /2 CPUs, 8 GB/.test(settings), settings.slice(0, 400))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Wren on OpenCode / Space Bunny (free), Cloud on, in a clone of ${REPO} with an uncommitted line.`, extra: `Checks failed: ${String(failures)}` })
  if (!keep) {
    for (const space of await oursOn()) {
      const gone = await gh(['codespace', 'delete', '-c', space.name, '--force'])
      say(`deleted ${space.name}: exit ${String(gone.code)}`)
    }
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
