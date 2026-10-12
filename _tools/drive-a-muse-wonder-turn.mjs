// A teammate on Muse Wonder (0.759): picked by name, a real turn in Ask, read whole.
//
//   LOCUST_SPEND=1 node _tools/drive-a-muse-wonder-turn.mjs [--packaged <exe>]
//
// Muse Wonder came out on 2026-10-12, and Colin took Muse Code's $5 plan that day "we got to test anyway". This
// SPENDS: two or three requests of that plan's allowance (Ask mode, a folder of two files, reasoning effort low). Its
// checks: the chat box names Muse Wonder 1.0 (the catalog now offers Muse Code's models); the turn answers, and says
// how many files there are; its searches show as steps; and nothing in the thread is an "Unhandled Muse" line -- a
// real run's records, which the echo fixtures never had, were sixteen of those on one short run.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const workspace = await scratchRepository('locust-drive-muse-wonder-ws-')
await writeFile(join(workspace, 'notes-a.txt'), 'alpha\n', 'utf8')
await writeFile(join(workspace, 'notes-b.txt'), 'beta\n', 'utf8')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'a-muse-wonder-turn',
  port: 9635,
  workspace,
  spends: true,
  outPath: join(recordRoot('a-muse-wonder-turn-2026-10-12'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_mira', name: 'Mira', hue: 'violet', role: 'Docs & QA', createdAt: '2026-10-12T17:00:00.000Z', route: { runtime: 'muse', model: 'muse-wonder-1.0', effort: 'low', mode: 'ask' } }
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

try {
  await drive.ready()
  await drive.resize(1215, 860)
  say(`open Mira: ${String(await drive.evaluate(openTeammateScript('Mira')))}`)
  await sleep(800)
  const route = String(await drive.evaluate(`([...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ').trim()`))
  await drive.capture('Mira, on Muse Wonder', () => route)
  // "Muse Code / Wonder 1.0": the chip drops the family word its agent's name already says, as "OpenCode / Space Bunny".
  check('the chat box names Muse Code and Wonder 1.0', /Muse Code/.test(route) && /Wonder 1\.0/.test(route), route)

  const sent = String(await drive.evaluate(sendAndWaitScript('List the files in this folder, then say how many there are.', { waitSeconds: 300 })))
  const thread = String(await drive.capture('the turn, answered', () => drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  say(`  thread: ${thread.slice(-400)}`)
  check('the turn answered, and says how many files', /finished/.test(sent) && /\b(?:two|three|four|2|3|4)\b/i.test(thread.slice(thread.indexOf('then say how many there are.') + 30)), thread.slice(-300))
  check('its searches show as steps', /search/i.test(thread), thread.slice(0, 300))
  check('nothing in the thread is a record Locust could not read', !/Unhandled Muse/i.test(thread), (thread.match(/Unhandled Muse[^.]*/i) ?? [''])[0])
  check('and it did not stop on Meta\'s billing', !/billing_error|payment method/i.test(thread), thread.slice(-200))
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Mira on Muse Code / Muse Wonder 1.0, Ask mode, a folder of two files.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
