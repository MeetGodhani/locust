// THE OVERNIGHT POLISH TEAMMATE (2026-10-12). Colin, on the ideas taken from the Grok Bot video -- "I'll run all your
// suggestions" -- among them "an overnight polish teammate that turns our sweep's findings into fixes for you to
// review each morning". Grok Bot's own team bot tested their product every night and opened fix pull requests by
// morning; this is Locust doing the same with Locust: a teammate in a Locust window of its own reads the drive
// sweep's report and fixes what it can, in a worktree, one commit per fix, and writes what it did. Nothing is pushed.
//
//   LOCUST_SPEND=1 node _tools/polish-after-the-sweep.mjs --sweep <sweep folder> --worktree <its worktree> --packaged <exe>
//
// The worktree is made beforehand (git worktree add -b polish/<date> D:\work\locust-wt\polish-<date> HEAD). Polish
// runs on Claude Code's Sonnet in Auto: nobody is at the window to answer a card, and it must run git, the drives and
// the tests -- told to work only in the worktree, push nothing and spend nothing, behind Locust's own command guard.
// It spends Claude usage, so it asks for LOCUST_SPEND=1. The window stays up until Polish's turn ends (at most
// --hours, default 3), then closes; its last reply is written to POLISH-REPLY.md in the worktree beside the
// POLISH-REPORT.md it is asked to write.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { openTeammateScript, recordRoot, say, sendAndWaitScript, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const sweep = arg('--sweep')
const worktree = arg('--worktree')
const packaged = arg('--packaged')
const hours = Number(arg('--hours') ?? '3')
if (sweep === undefined || worktree === undefined || packaged === undefined) {
  say('usage: LOCUST_SPEND=1 node _tools/polish-after-the-sweep.mjs --sweep <folder> --worktree <folder> --packaged <exe> [--hours 3]')
  process.exit(2)
}

const brief = [
  `You are Polish, Locust's overnight teammate. Last night Locust's drive sweep ran every free drive in _tools against the packaged build; its results are in ${sweep}: SUMMARY.md has one row per drive (PASS, FAIL, TIMED OUT, EXIT), logs/ has each drive's whole output, and captures/ has the frames each drive took.`,
  'For each drive that did not pass, in the order SUMMARY.md lists them:',
  '1. Read its log, and the frames it names. Decide which it is: the APP is wrong (a real bug a person would meet); the DRIVE is stale (a selector, label or text the app no longer draws, a free model that left OpenCode\'s list, a wait too short); the provider failed (a free model rate-limited or down); or you cannot tell.',
  '2. A stale drive: fix the drive in _tools/ so it checks what the app draws now, without making it check less.',
  '3. An app bug whose cause you can see and whose fix is small: fix it in apps/desktop/src, with a vitest test named for the behaviour that fails without the fix.',
  '4. Anything else: leave the code alone and write down what you saw.',
  `To check a drive you changed, run it as the sweep did: node _tools/<drive>.mjs --packaged ${packaged}. Do not run the whole sweep or the whole test suite; run the tests you wrote with npx vitest run <file> from apps/desktop if node_modules is there, and say so if it is not.`,
  'One commit per fix, its message naming the drive and why. Work only in this folder. Never push, never change a version or the CHANGELOG, never set LOCUST_SPEND, and never run anything that would spend a paid account.',
  'When you are done, write POLISH-REPORT.md at this folder\'s root: a table with one row per drive that did not pass -- the drive, your verdict (app bug, stale drive, provider, unclear), what you changed, the commit, and how you checked it -- then two or three lines on what a person should look at first.'
].join('\n\n')

const drive = await startDrive({
  packaged,
  name: 'polish-after-the-sweep',
  port: 9633,
  workspace: worktree,
  spends: true,
  outPath: join(recordRoot('polish-after-the-sweep-2026-10-12'), 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_polish', name: 'Polish', hue: 'butter', role: 'Docs & QA', roleTitle: 'Overnight polish', createdAt: '2026-10-12T12:00:00.000Z', route: { runtime: 'claude', model: 'claude-sonnet-5-5', mode: 'auto' } }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})

let reply = ''
try {
  await drive.ready()
  await drive.resize(1215, 860)
  say(`open Polish: ${String(await drive.evaluate(openTeammateScript('Polish')))}`)
  // The route chip as the drive library reads it: the composer's one control that opens a listbox.
  const route = String(await drive.evaluate(`([...document.querySelectorAll('.lc-control')].find((b) => b.getAttribute('aria-haspopup') === 'listbox')?.innerText ?? '').replace(/\\s+/g, ' ')`))
  say(`route: ${route}`)
  if (!/sonnet/i.test(route)) throw new Error(`Polish is not on Sonnet: "${route}"`)
  const sent = String(await drive.evaluate(sendAndWaitScript(brief, { waitSeconds: Math.round(hours * 3600), settle: true })))
  reply = String(await drive.evaluate(`(document.querySelector('.lc-thread')?.innerText ?? '').slice(-20000)`))
  say(`Polish: ${sent.slice(0, 300)}`)
  await drive.capture('Polish, done', () => sent.slice(-400))
} catch (error) {
  say(`polish failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await writeFile(join(worktree, 'POLISH-REPLY.md'), `# Polish's last reply\n\n${reply}\n`, 'utf8').catch(() => undefined)
  await drive.finish({ intro: `Build: ${packaged}. Polish read the sweep at ${sweep} and worked in ${worktree}.` })
}
