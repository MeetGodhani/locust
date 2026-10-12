// A teammate's turn on YOUR CLOUD COMPUTER (0.761), the way a person meets it: Cloud picked in the chat-type menu for
// an OpenCode teammate, the first-time dialog (what it is, what it costs) set up, a task sent, the change shown and
// brought home, a second turn in the same conversation, and Settings > Cloud computers. And since 0.762: the brief
// never names this PC's folder there, a cloud turn's file rows offer nothing that acts on this folder's file until its
// change is here, a file attached from outside the folder reaches the copy there, and a change goes to a pull request
// -- refused in words when it leans on edits GitHub does not have, opened on GitHub when it does not.
//
//   node _tools/drive-a-cloud-turn.mjs [--packaged <exe>] [--fresh] [--keep]
//
// Spends nothing: a free OpenCode model, and GitHub's free codespace hours (2 CPUs, a few minutes). It works on the
// throwaway repository made for Codex Cloud on 09-30 (automatedworkflowllc-design/locust-cloud-test), never one of
// Colin's own; the pull request it opens there is closed and its branch deleted at the end. `--fresh` deletes
// Locust's cloud computer for it first, so the dialog makes one; `--keep` leaves the one the drive used (it stops
// itself after 10 quiet minutes either way).

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
/** The branches Locust pushed on the test repository: none should be there but the pull request's. */
const locustBranches = async () => {
  const listed = await gh(['api', `repos/${REPO}/git/matching-refs/heads/locust/`])
  return listed.code === 0 ? JSON.parse(listed.stdout || '[]').map((ref) => String(ref.ref).replace(/^refs\/heads\//, '')) : []
}
/** The test repository left as it was found: every pull request from a locust/ branch closed, every such branch gone. */
const tidyGitHub = async () => {
  const open = await gh(['pr', 'list', '--repo', REPO, '--state', 'open', '--json', 'number,headRefName'])
  for (const pr of open.code === 0 ? JSON.parse(open.stdout || '[]') : []) {
    if (!String(pr.headRefName).startsWith('locust/')) continue
    const closed = await gh(['pr', 'close', String(pr.number), '--repo', REPO, '--delete-branch'])
    say(`closed pull request #${String(pr.number)}: exit ${String(closed.code)}`)
  }
  for (const branch of await locustBranches()) {
    const gone = await gh(['api', '-X', 'DELETE', `repos/${REPO}/git/refs/heads/${branch}`])
    say(`deleted branch ${branch}: exit ${String(gone.code)}`)
  }
}

if (fresh) {
  for (const space of await oursOn()) {
    const gone = await gh(['codespace', 'delete', '-c', space.name, '--force'])
    say(`deleted ${space.name} first: exit ${String(gone.code)}`)
  }
}
await tidyGitHub()

// A clone of the test repository with a line written here and not committed: the cloud copy must carry it.
const root = await mkdtemp(join(tmpdir(), 'locust-drive-cloud-turn-ws-'))
const workspace = join(root, 'locust-cloud-test')
const cloned = await gh(['repo', 'clone', REPO, workspace])
if (cloned.code !== 0) throw new Error(`clone failed: ${cloned.stderr}`)
const readme = await readFile(join(workspace, 'README.md'), 'utf8')
const HERE_LINE = 'A line written on this computer and never committed: kiwi-lantern.'
await writeFile(join(workspace, 'README.md'), `${readme.trimEnd()}\n\n${HERE_LINE}\n`, 'utf8')
// A file from OUTSIDE the folder, attached on the third turn: Locust copies it into .locust/attachments, which git
// never sees -- so it reaches the cloud computer only if Locust sends it there (0.762).
const NOTE_WORD = 'amber-quokka-lighthouse'
const note = join(root, 'cloud-note.txt')
await writeFile(note, `The note says: ${NOTE_WORD}\n`, 'utf8')

const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-cloud-turn',
  port: 9643,
  workspace,
  env: { LOCUST_ATTACH_PATHS: note },
  outPath: join(recordRoot('a-cloud-turn-and-pull-request-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
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
/** The newest change card's own button, by the words it starts with. */
const clickInLastCard = (words) => drive.evaluate(`(() => {
  const card = [...document.querySelectorAll('.lc-cloudchange')].at(-1)
  const found = [...(card?.querySelectorAll('button') ?? [])].find((one) => one.innerText.replace(/\\s+/g, ' ').trim().startsWith(${JSON.stringify(words)}))
  if (!found) return 'no ' + ${JSON.stringify(words)} + ' in: ' + (card?.innerText ?? 'no card').replace(/\\s+/g, ' ').slice(0, 200)
  found.click()
  return 'clicked'
})()`)
const lastCard = () => drive.evaluate(`([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)
/**
 * The newest cloud turn's file rows (its foot, "Edited N files") and handed files, and the controls on them that act on
 * this folder's file. Only what comes after that turn's marker: an earlier turn's chips, home by then, offer theirs
 * rightly (a 0.762 run counted turn 1's two under turn 3).
 */
const fileControls = () => drive.evaluate(`(() => {
  const marker = [...document.querySelectorAll('.lc-thread .lc-cloudmarker')].at(-1)
  const after = (node) => marker !== undefined && Boolean(marker.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
  const foot = [...document.querySelectorAll('.lc-thread .lc-turnfoot')].filter(after).at(-1)
  const handed = [...document.querySelectorAll('.lc-thread .lc-handedfiles')].filter(after)
  return {
    rows: foot?.querySelectorAll('.lc-filerow').length ?? 0,
    local: (foot?.querySelectorAll('.lc-filerow__view, .lc-filerow__copy, .lc-filerow__reveal').length ?? 0) + handed.reduce((sum, one) => sum + one.querySelectorAll('.lc-handedfile__save').length, 0)
  }
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
let pullRequestNumber

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
  // 0.761's reply said "Note: the Windows path you gave maps to the workspace root here": it had been told this PC's path.
  check("the teammate there was never told this PC's folder", !/Windows path|C:\\|maps to the workspace root/i.test(thread), (thread.match(/.{0,120}(?:Windows path|C:\\|maps to the workspace root).{0,80}/i) ?? [''])[0])
  // Its change is read from the cloud computer once the turn ends: a few seconds, said on the thread meanwhile.
  await until(`/The change is on your cloud computer/.test(document.querySelector('.lc-cloudchange')?.innerText ?? '')`, 60)
  const card = String(await drive.capture('its change, waiting there', () => text('.lc-cloudchange')))
  check('its change waits on the cloud computer', /The change is on your cloud computer/.test(card) && /greeting\.txt/.test(card) && /not here yet/.test(card), card)
  check('nothing came here before Apply', !(await readFile(join(workspace, 'greeting.txt'), 'utf8').then(() => true, () => false)))
  const away = await fileControls()
  check("its file rows offer nothing that acts on this folder's file while the change is there", away.rows > 0 && away.local === 0, JSON.stringify(away))

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
  const here = await fileControls()
  check('once it is here, its file rows open, copy and show the file again', here.rows > 0 && here.local > 0, JSON.stringify(here))

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
  say(`  show the second: ${String(await clickInLastCard('Show the change'))}`)
  await until(`/goodbye from the cloud/.test([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.querySelector('.lc-review__files')?.innerText ?? '')`, 60)
  const secondShown = String(await drive.capture("the second turn's change, shown", () => drive.evaluate(`([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.querySelector('.lc-review__files')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  check("the second turn's change is only what is new", /^The change is on your cloud computer 1 file/.test(latest) && /greeting\.txt/.test(secondShown) && /goodbye from the cloud/.test(secondShown) && !/greeting\.txt added/i.test(secondShown), `${latest} :: ${secondShown.slice(0, 300)}`)

  // A pull request of THIS change cannot be made: greeting.txt is only in this folder, never pushed. Said in words, and
  // nothing goes to GitHub.
  say(`  open a pull request: ${String(await clickInLastCard('Open a pull request'))}`)
  await until(`document.querySelector('.lc-cloudchange__pr textarea')`, 10)
  const draft = String(await drive.evaluate(`document.querySelector('.lc-cloudchange__pr textarea')?.value ?? ''`))
  await drive.capture('a pull request, its message drafted', () => lastCard())
  check('the pull request is drafted from what was asked, the teammate named', /^Append a second line to greeting\.txt/.test(draft) && /Locust-Teammate: Wren/.test(draft), draft)
  say(`  send it: ${String(await click('.lc-cloudchange__pr button', 'Open the pull request'))}`)
  await until(`document.querySelector('.lc-cloudchange__problem') || /Sent to pull request/.test(document.querySelector('.lc-thread')?.innerText ?? '')`, 180)
  const refused = String(await drive.capture('refused: it leans on edits GitHub does not have', () => text('.lc-cloudchange__problem')))
  check('a change that leans on edits only this folder has is refused in words', /builds on edits in this folder that GitHub does not have/.test(refused), refused)
  check('and nothing was pushed to GitHub', (await locustBranches()).length === 0, (await locustBranches()).join(', '))
  // The reason says "Apply it here instead": the card is back at its buttons to do just that, not at the same form.
  const back = await drive.evaluate(`(() => { const card = [...document.querySelectorAll('.lc-cloudchange')].at(-1); return { form: Boolean(card?.querySelector('.lc-cloudchange__pr')), apply: [...(card?.querySelectorAll('button') ?? [])].some((one) => one.innerText.trim() === 'Apply to this folder') } })()`)
  check('and the card is back at its buttons, Apply among them', back?.form === false && back?.apply === true, JSON.stringify(back))
  say(`  apply the second: ${String(await clickInLastCard('Apply to this folder'))}`)
  const secondHome = await until(`/^Brought into this folder/.test(([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.innerText ?? '').trim())`, 90)
  check('the second change comes home instead', secondHome && /goodbye from the cloud/.test(await readFile(join(workspace, 'greeting.txt'), 'utf8').catch(() => '')))

  // A third turn, with a file attached from outside the folder: it reaches the copy there, and a new file that leans on
  // nothing of this folder's goes to a pull request on GitHub.
  say(`  attach: ${String(await drive.evaluate(`(() => { const button = document.querySelector('button[data-satellite="attach"]'); if (!button) return 'no attach button'; button.click(); return 'clicked' })()`))}`)
  const attached = await until(`document.querySelector('.lc-attached__tile')`, 15)
  check('the outside file is attached', attached, String(await text('.lc-attached')))
  // Written with its own tool, so the turn's foot lists the file (a `cp` writes it unseen, and the rows check has nothing).
  const third = await sendAndWait("Add note-from-the-cloud.txt holding the attached file's one line. Write it with your file-writing tool, not a shell command. Change no other file, and quote the line in your reply.", 300)
  const thread3 = String(await drive.capture('a third turn, with a file attached from outside the folder', () => text('.lc-thread')))
  check('the third turn ended', third, thread3.slice(-200))
  check('the attached file reached the cloud computer: its word is quoted', thread3.split(NOTE_WORD).length > 1, thread3.slice(-400))
  await until(`/not here yet/.test(([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.innerText ?? ''))`, 90)
  const thirdCard = String(await lastCard())
  check("the change holds the new file, and never Locust's copy of the attachment", /note-from-the-cloud\.txt/.test(thirdCard) && !/\.locust/.test(thirdCard), thirdCard)

  say(`  open a pull request: ${String(await clickInLastCard('Open a pull request'))}`)
  await until(`document.querySelector('.lc-cloudchange__pr textarea')`, 10)
  say(`  send it: ${String(await click('.lc-cloudchange__pr button', 'Open the pull request'))}`)
  const sent = await until(`/Sent to pull request #\\d+/.test(([...document.querySelectorAll('.lc-cloudchange')].at(-1)?.innerText ?? ''))`, 180)
  const sentCard = String(await drive.capture('sent to a pull request on GitHub', () => lastCard()))
  pullRequestNumber = /Sent to pull request #(\d+)/.exec(sentCard)?.[1]
  check('the change went to a pull request, named on its card with a way to open it', sent && pullRequestNumber !== undefined && /Open on GitHub/.test(sentCard), `${sentCard} ${String(await text('.lc-cloudchange__problem'))}`)
  if (pullRequestNumber !== undefined) {
    const viewed = await gh(['pr', 'view', pullRequestNumber, '--repo', REPO, '--json', 'state,baseRefName,headRefName,files'])
    const pr = viewed.code === 0 ? JSON.parse(viewed.stdout) : undefined
    const files = (pr?.files ?? []).map((file) => file.path)
    check('on GitHub: open, for main, from a branch of its own, holding only the new file', pr?.state === 'OPEN' && pr.baseRefName === 'main' && String(pr.headRefName).startsWith('locust/') && files.length === 1 && files[0] === 'note-from-the-cloud.txt', `${viewed.stdout.slice(0, 300)} ${viewed.stderr}`)
    // Names only: the commits' own record carries an email address, which never goes in a drive's log.
    const commits = await gh(['pr', 'view', pullRequestNumber, '--repo', REPO, '--json', 'commits', '--jq', '[.commits[].authors[].name] | join(",")'])
    const authors = commits.stdout.trim().split(',').filter((who) => who.length > 0)
    check('committed as the person, not as Locust', authors.length > 0 && !authors.some((who) => /^Locust$/i.test(who)), authors.join(', '))
  }
  const after = await fileControls()
  // Only a turn that wrote its file with its own tool has rows to look at: one with none is said, and not counted.
  if (after.rows > 0) check('its file rows still offer nothing of this folder: the change is on GitHub, not here', after.local === 0, JSON.stringify(after))
  else say('  [SKIP] its file rows: the teammate wrote the file with a command, so this turn lists none')

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
  await tidyGitHub()
  if (!keep) {
    for (const space of await oursOn()) {
      const gone = await gh(['codespace', 'delete', '-c', space.name, '--force'])
      say(`deleted ${space.name}: exit ${String(gone.code)}`)
    }
  }
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
