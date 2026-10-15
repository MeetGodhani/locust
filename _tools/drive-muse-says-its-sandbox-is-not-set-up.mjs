// Muse Code's own Windows sandbox, not set up on this computer, said once and plainly (0.772).
//
//   LOCUST_SPEND=1 node _tools/drive-muse-says-its-sandbox-is-not-set-up.mjs [--packaged <exe>]
//
// In the voxel round (2026-10-13) Muse Wonder could not run one command: every shell task failed "sandbox
// enforcement unavailable: windows_elevated setup_required: sandbox users are not ready", and the person saw only
// failed rows. On THIS machine `muse sandbox windows check` still says setup_required, so a teammate on Muse in Edit
// (Locust's ordinary writing mode: the sandbox stays on) meets it on its first command. This SPENDS one or two
// requests of Colin's Muse Code plan (Muse Spark 1.3, effort low). Its checks: the turn finishes; the thread says
// once, in a sentence, that the sandbox is not set up and names `muse sandbox windows setup`; nothing is unhandled.
// On a machine where the sandbox IS set up, the command runs and the line must not appear: the drive says which.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, scratchRepository, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
// `--mode auto` (0.773): Auto runs outside Muse's sandbox, so the command runs and the line never appears.
const mode = arg('--mode') ?? 'accept-edits'
const auto = mode === 'auto'

/** Muse's own word on its sandbox, read-only: `status=setup_required` until someone sets it up. */
let status = 'unknown'
try {
  status = /status=(\S+)/.exec(execFileSync('cmd.exe', ['/d', '/s', '/c', 'muse sandbox windows check'], { encoding: 'utf8' }))?.[1] ?? 'unknown'
} catch (error) {
  status = /status=(\S+)/.exec(String(error?.stdout ?? ''))?.[1] ?? 'unknown'
}
say(`muse sandbox windows check: status=${status}`)
const notSetUp = status === 'setup_required'

const workspace = await scratchRepository('locust-drive-muse-sandbox-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'muse-says-its-sandbox-is-not-set-up',
  port: 9938,
  workspace,
  spends: true,
  outPath: join(recordRoot('muse-says-its-sandbox-is-not-set-up-2026-10-14'), `${packaged === undefined ? 'local' : 'packaged'}${auto ? '-auto' : ''}`),
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_mira', name: 'Mira', hue: 'violet', role: 'Docs & QA', createdAt: '2026-10-14T01:00:00.000Z', route: { runtime: 'muse', model: 'muse-spark-1.3', effort: 'low', mode } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: auto }
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
  const sent = String(await drive.evaluate(sendAndWaitScript('Run the shell command `Write-Output hello` once and tell me what it printed. Do nothing else.', { waitSeconds: 300 })))
  const thread = String(await drive.capture('the turn, answered', () => drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').replace(/\\s+/g, ' ')`)))
  say(`  thread: ${thread.slice(-600)}`)
  const lines = thread.match(/Muse Code can't run commands on this computer yet/g) ?? []
  check('the turn finished', /finished/.test(sent), sent)
  if (auto) {
    const after = thread.slice(thread.indexOf('Do nothing else.') + 'Do nothing else.'.length)
    check('in Auto the command ran: the answer says hello', /\bhello\b/i.test(after), after.slice(-300))
    check('and nothing failed', !/\d+ failed/.test(thread), (thread.match(/\d+ failed/) ?? [''])[0])
    check('and the sandbox line does not appear', lines.length === 0, `${String(lines.length)} times`)
  } else if (notSetUp) {
    check('the thread says the sandbox is not set up, once', lines.length === 1, `${String(lines.length)} times`)
    check('and leads with switching to Auto', thread.includes('Switch this teammate to Auto'), thread.slice(-300))
    check('and names the command that sets it up', thread.includes('muse sandbox windows setup'), thread.slice(-300))
  } else {
    check(`the sandbox is ${status} here, so the line does not appear`, lines.length === 0, `${String(lines.length)} times`)
  }
  check('nothing in the thread is a record Locust could not read', !/Unhandled Muse/i.test(thread), (thread.match(/Unhandled Muse[^.]*/i) ?? [''])[0])
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Mira on Muse Code / Muse Spark 1.3, ${auto ? 'Auto' : 'Edit'}, low; Muse's sandbox: ${status}.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
