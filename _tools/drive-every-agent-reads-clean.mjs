// Every agent's turn reads clean (0.735): one short real turn on each agent, on its cheapest route, and nothing
// under the answer that Locust did not know how to read.
//
//   LOCUST_SPEND=1 node _tools/drive-every-agent-reads-clean.mjs [--packaged <exe>] [--only claude,codex]
//
// The agents update themselves. Copilot 1.0.95 did on 2026-10-10 and drew four "Unhandled Copilot record" lines
// under every answer until 0.721 read them. This is the check for that across the agents Locust runs here:
// Claude Code on Haiku, Codex on GPT-6-Luna (Low), Copilot on its Auto model, Antigravity on Flash, OpenCode on
// its free model -- each asked to run one `echo` and say what it printed. Cursor is left out (cursor-agent is not
// run on this machine: any --model rewrites the person's Cursor default), Gemini is refused before it runs, Muse is
// not installed. One turn each: Haiku, one Luna turn, one Copilot premium request, one Antigravity Flash turn.

import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const only = arg('--only')?.split(',')
const AGENTS = [
  { id: 'tm_claude', name: 'Hal', runtime: 'claude', route: { runtime: 'claude', model: 'haiku', mode: 'auto' }, header: /claude/i },
  { id: 'tm_codex', name: 'Cody', runtime: 'codex', route: { runtime: 'codex', model: 'gpt-6-luna', effort: 'low', mode: 'auto' }, header: /codex/i },
  { id: 'tm_copilot', name: 'Pilot', runtime: 'copilot', route: { runtime: 'copilot', model: 'auto', mode: 'auto' }, header: /copilot/i },
  { id: 'tm_antigravity', name: 'Agee', runtime: 'antigravity', route: { runtime: 'antigravity', model: 'flash', mode: 'auto' }, header: /antigravity/i },
  { id: 'tm_opencode', name: 'Oakley', runtime: 'opencode', route: { runtime: 'opencode', model: 'opencode/nemotron-3-ultra-free', mode: 'accept-edits' }, header: /opencode/i }
].filter((agent) => only === undefined || only.includes(agent.runtime))

const workspace = await scratchRepository('locust-drive-every-agent-ws-')
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: `every-agent-reads-clean${packaged === undefined ? '' : '-packaged'}`,
  port: 9598,
  workspace,
  spends: true,
  outPath: join(recordRoot('every-agent-reads-clean-2026-10-10'), packaged === undefined ? 'local' : 'packaged'),
  seed: {
    schemaVersion: 1,
    teammates: AGENTS.map((agent) => ({ teammateId: agent.id, name: agent.name, hue: 'lime', role: 'Custom', roleTitle: 'Builder', createdAt: '2026-10-10T10:00:00.000Z', route: agent.route })),
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: true }
  }
})
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 500)}`}`)
}
try {
  await drive.ready()
  await drive.resize(1209, 770)
  await sleep(1500)
  for (const agent of AGENTS) {
    await drive.evaluate(`(async () => { ${teammateFace(agent.name)}.click(); await new Promise(r => setTimeout(r, 800)) })()`)
    const route = String(await drive.evaluate(`[...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`))
    if (!agent.header.test(route)) {
      check(`${agent.runtime}: the composer is on it before anything is sent`, false, route)
      continue
    }
    const sent = await drive.evaluate(`(async () => {
      const box = document.querySelector('textarea[aria-label="Message"]')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Run this shell command once and reply with what it printed: echo locust-reads-clean')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 250))
        const button = document.querySelector('button[aria-label="Send"]')
        if (button && !button.disabled) { button.click(); return 'sent' }
      }
      return 'no send'
    })()`)
    if (sent !== 'sent') {
      check(`${agent.runtime}: sent`, false, sent)
      continue
    }
    const seconds = await drive.capture(`${agent.runtime}'s turn`, async () => {
      for (let second = 0; second < 300; second += 1) {
        await sleep(1000)
        if (second > 5 && !(await drive.evaluate(`!!document.querySelector('button[aria-label^="Stop the running"]')`))) return second
      }
      return undefined
    })
    const read = JSON.parse(String(await drive.evaluate(`JSON.stringify({
      text: document.querySelector('.lc-thread')?.innerText.replace(/\\s+/g, ' ') ?? '',
      notes: [...document.querySelectorAll('.lc-diagnostic')].map((el) => el.innerText.replace(/\\s+/g, ' ').trim())
    })`)))
    check(`${agent.runtime}: the turn ended on its own`, seconds !== undefined, `${String(seconds)}s`)
    check(`${agent.runtime}: it answered with what the command printed`, /locust-reads-clean/.test(read.text.split('Run this shell command once').pop() ?? ''), read.text.slice(-300))
    check(`${agent.runtime}: nothing under it Locust could not read`, !read.notes.some((note) => /Unhandled|did not know|could not read/i.test(note)), read.notes.join(' | ') || 'no notes')
    if (read.notes.length > 0) say(`    notes: ${read.notes.join(' | ').slice(0, 400)}`)
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. One short turn on each agent's cheapest route.`, extra: `Checks failed: ${String(failures)}` })
}
say(failures === 0 ? 'ALL CHECKS PASSED' : `${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
