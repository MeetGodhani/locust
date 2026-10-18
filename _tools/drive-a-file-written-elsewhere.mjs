// A teammate writes a file outside its folder and hands it over by its whole path (0.787).
//
//   node _tools/drive-a-file-written-elsewhere.mjs [--packaged <exe>] [--tag <name>]
//
// Colin, 2026-10-18: Codex wrote its review to D:\work\scratch where it was asked to and
// handed it over by that path; the thread said "Not shown as a file", and the step that
// wrote it would not open it either. "claude code and the other apps still let you access
// the file." Ash, on Auto in a scratch folder, writes a report in a folder Locust has never
// worked in and hands it over by its whole path. The card must be drawn and open the
// report, and so must the row of the step that wrote it. The window asking for a file in
// that same folder that no teammate named must still be refused. Free model.

import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const tag = arg('--tag') ?? 'local'
const workspace = await scratchRepository('locust-drive-written-elsewhere-ws-')
// Somewhere Locust has never worked, the way D:\work\scratch was.
const elsewhere = await mkdtemp(join(tmpdir(), 'locust-drive-written-elsewhere-out-'))
const report = join(elsewhere, 'report.md').replace(/\\/g, '/')
const secret = join(elsewhere, 'secret.md')
await writeFile(secret, 'NOBODY HANDED THIS OVER\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `a-file-written-elsewhere-${tag}`,
  port: 9829,
  workspace,
  outPath: join(recordRoot('a-file-written-elsewhere-2026-10-18'), tag),
  seed: {
    schemaVersion: 1,
    // Auto: on any other mode OpenCode is told it may not leave its folder.
    teammates: [{ teammateId: 'tm_ash', name: 'Ash', hue: 'clay', role: 'Custom', roleTitle: 'Helper', createdAt: '2026-09-05T05:00:00.000Z', route: { ...FREE_ROUTE, mode: 'auto' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 260)}`}`)
}
const viewerText = `(async () => {
  for (let i = 0; i < 40 && !document.querySelector('.lc-viewer__scroll'); i += 1) await new Promise((r) => setTimeout(r, 250))
  await new Promise((r) => setTimeout(r, 600))
  return (document.querySelector('.lc-viewer')?.innerText ?? 'no viewer').replace(/\\s+/g, ' ').slice(0, 300)
})()`
const closeViewer = `(async () => { document.querySelector('.lc-viewer__close')?.click(); await new Promise((r) => setTimeout(r, 500)) })()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.evaluate(openTeammateScript('Ash'))
  await drive.capture('Ash writes a report elsewhere and hands it over', () => drive.evaluate(sendAndWaitScript(
    `Use your file-writing tool (not a shell command) to create the file ${report} with exactly this one line: THE REPORT WRITTEN ELSEWHERE\n` +
    `Then reply with exactly the following lines and nothing else:\n<locust-file>\n${report} :: the report\n</locust-file>`
  )))
  const onDisk = await readFile(report, 'utf8').catch(() => '')
  check('Ash wrote the report where it was asked to', /THE REPORT WRITTEN ELSEWHERE/.test(onDisk), onDisk.slice(0, 120))
  const shown = JSON.parse(String(await drive.evaluate(`JSON.stringify({
    cards: [...document.querySelectorAll('.lc-handedfile')].map((b) => b.innerText.replace(/\\s+/g, ' ').trim()),
    notShown: [...document.querySelectorAll('.lc-thread *')].some((el) => el.children.length === 0 && /Not shown as a file/.test(el.textContent ?? ''))
  })`)))
  check('the thread draws a card for it', shown.cards.some((text) => /report\.md/.test(text)), JSON.stringify(shown.cards))
  check('and does not say "Not shown as a file"', !shown.notShown)
  await drive.evaluate(`[...document.querySelectorAll('.lc-handedfile__open')].find((b) => /report\\.md/.test(b.innerText))?.click()`)
  const fromCard = String(await drive.capture('the card, pressed', () => drive.evaluate(viewerText)))
  check('the card opens the report', /THE REPORT WRITTEN ELSEWHERE/.test(fromCard), fromCard)
  await drive.evaluate(closeViewer)
  const rows = Number(await drive.evaluate(`document.querySelectorAll('.lc-thread .lc-turnfoot .lc-filerow__view').length`))
  if (rows === 0) {
    check('the step that wrote it is a row in the turn\'s foot', false, 'no file row with an Open button')
  } else {
    await drive.evaluate(`[...document.querySelectorAll('.lc-thread .lc-turnfoot .lc-filerow__view')].find((b) => /report\\.md/.test(b.getAttribute('title') ?? ''))?.click()`)
    const fromRow = String(await drive.capture('the row of the step that wrote it, pressed', () => drive.evaluate(viewerText)))
    check('the row of the step that wrote it opens the report too', /THE REPORT WRITTEN ELSEWHERE/.test(fromRow), fromRow)
    await drive.evaluate(closeViewer)
  }
  const asked = JSON.parse(String(await drive.evaluate(`(async () => {
    const read = await window.desktop.readTextFile(${JSON.stringify(secret)})
    const reveal = await window.desktop.revealFile(${JSON.stringify(secret)})
    return JSON.stringify({ read: read.ok ? 'READ: ' + read.text : read.message, reveal: reveal.ok ? 'REVEALED' : reveal.message })
  })()`)))
  check('the window asking for a file nobody named is refused', !/NOBODY HANDED THIS OVER/.test(asked.read) && /no teammate wrote it or handed it over/.test(asked.read), asked.read)
  check('and so is showing it in its folder', asked.reveal !== 'REVEALED', asked.reveal)
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Ash on Auto in one folder; the report written in another Locust never worked in.`, extra: `Checks failed: ${String(failures)}` })
}
if (failures > 0) process.exitCode = 1
