// What a long history costs the window while a reply streams (review 2026-10-15, P1 and P2).
//
//   LOCUST_SPEND=1 node _tools/probe-a-long-history-streams.mjs --conversations 700 --tag <name> [--packaged <exe>]
//
// The review measured, on Linux with no GPU: a streamed reply drew at 55 fps with 17 conversations listed and 7.5
// with 667, the window blocked 9.4 to 10 s of every 10; clearing the search box froze it 6.9 s. This measures the
// same three things on this machine, against a seeded ledger of N one-turn conversations owned by four teammates:
//
//   boot      long tasks (over 50 ms) from the window's first script to its rows, summed and the longest
//   search    the longest task after clearing a search that matched nothing (every row comes back)
//   stream    frames in 10 s, frame gap median and p95, and long-task time, while the stand-in streams
//
// The reply comes from _tools/fake-claude: no model is asked and nothing is spent. Its route is Claude Code's, so
// the app's free-only guard is lifted (LOCUST_SPEND=1), and nothing is sent until the app's own discovery reports
// the stand-in's version. Compare builds ALTERNATELY (old, new, old, new).

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const { createFileMissionLedger } = await import(new URL('../packages/mission-store/dist/index.js', import.meta.url).href)

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const conversations = Number(arg('--conversations') ?? 700)
const tag = arg('--tag') ?? 'local'
const packaged = arg('--packaged')
const port = Number(arg('--port') ?? 9879)
const FAKE_DIR = join(here, 'fake-claude')
const FAKE_VERSION = '0.0.0-locust-fake'

const NAMES = ['Wren', 'Atlas', 'Juno', 'Mica']
const HUES = ['lime', 'blue', 'violet', 'coral']
const at = '2026-10-01T09:00:00.000Z'
const team = NAMES.map((name, index) => ({
  teammateId: `tm_${name.toLowerCase()}`,
  name,
  hue: HUES[index],
  role: 'Custom',
  roleTitle: 'Writer',
  createdAt: at,
  route: { runtime: 'claude', model: 'claude-haiku-4-5', mode: 'ask' }
}))

// The ledger, written by the store's own writer: one turn each, a question, a short answer, an end.
const profile = await mkdtemp(join(tmpdir(), 'locust-long-history-'))
const ledger = createFileMissionLedger({ rootDirectory: join(profile, 'mission-ledger') })
const missionOwners = {}
const process0 = { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, inputDeliveryFailed: false, outputLimitExceeded: false, forcedTerminationAttempted: false, terminationUnconfirmed: false }
for (let index = 0; index < conversations; index += 1) {
  const missionId = `mission_seed_${String(index).padStart(5, '0')}`
  const runId = `run_seed_${String(index).padStart(5, '0')}`
  const started = new Date(Date.parse(at) + index * 60_000).toISOString()
  const ended = new Date(Date.parse(started) + 30_000).toISOString()
  await ledger.createMission({
    missionId, runId, prompt: `Seeded question number ${String(index)} about the build`, runtime: 'claude', model: 'claude-haiku-4-5',
    requestedRouteId: 'claude', resolvedRouteId: 'claude-account:claude-haiku-4-5', cliVersion: FAKE_VERSION, workspaceId: 'ws_seed',
    sandbox: 'read-only', mode: 'ask', executionPolicyVersion: 1, createdAt: started
  })
  const event = (sequence, type, payload, occurredAt) => ({ id: `${runId}:claude:${String(sequence)}`, runId, missionId, sequence, occurredAt, sourceAdapter: 'claude', type, payload })
  await ledger.appendEvents(missionId, [
    event(1, 'run.started', { runtimeThreadId: `thread_${String(index)}`, evidence: { redacted: false } }, started),
    event(2, 'message.delta', { itemId: 'm1', operation: 'replace', text: `Answer ${String(index)}: the build is green and the notes are in the folder.`, final: true, evidence: { redacted: false } }, ended),
    event(3, 'run.completed', { runtimeThreadId: `thread_${String(index)}`, process: { ...process0, startedAt: started, finishedAt: ended } }, ended)
  ])
  missionOwners[missionId] = team[index % team.length].teammateId
}
await ledger.flush()
say(`seeded ${String(conversations)} conversations`)

const OUT = join(recordRoot('long-history-streams-2026-10-15'), `${tag}-${String(conversations)}`)
await mkdir(OUT, { recursive: true })
const fakeEnv = { PATH: [FAKE_DIR, ...(process.env.PATH ?? '').split(';').filter((dir) => dir !== '' && !existsSync(join(dir, 'claude.exe')) && !existsSync(join(dir, 'claude.cmd')))].join(';'), FAKE_CLAUDE_WORDS: '4000', FAKE_CLAUDE_DELTA_MS: '40' }
const drive = await startDrive({
  name: `long-history-${tag}`, port, workspace: await scratchRepository('locust-long-history-ws-'), profilePath: profile, outPath: OUT, spends: true, env: fakeEnv,
  ...(packaged === undefined ? {} : { packaged }),
  seed: { schemaVersion: 1, teammates: team, missionOwners, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

const results = { tag, conversations, build: packaged ?? 'out/' }
try {
  await drive.ready()
  await drive.resize(1400, 860)
  // Boot: the long tasks Chromium kept from before this script could watch (buffered), up to the rows.
  for (let i = 0; i < 120; i += 1) {
    if (Number(await drive.evaluate(`document.querySelectorAll('.lc-convrow').length`)) > 0) break
    await sleep(250)
  }
  await sleep(3000)
  results.boot = JSON.parse(String(await drive.evaluate(`(() => {
    const tasks = performance.getEntriesByType('longtask').map((t) => t.duration)
    return JSON.stringify({ rowsMounted: document.querySelectorAll('.lc-convrow').length, faces: document.querySelectorAll('.lc-convrow [data-teammate]').length, longTaskSumMs: Math.round(tasks.reduce((a, b) => a + b, 0)), longestMs: Math.round(Math.max(0, ...tasks)), nodes: document.getElementsByTagName('*').length })
  })()`)))
  say(`boot: ${JSON.stringify(results.boot)}`)

  // Search for nothing, then clear it: every row comes back at once.
  const search = async (text) => drive.evaluate(`(async () => {
    const box = document.querySelector('.lc-sidebar input[type="search"], .lc-sidebar input[aria-label*="earch"]')
    if (!box) return 'no search box'
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(text)})
    box.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  const typed = await search('zzzz')
  if (typed !== 'typed') throw new Error(String(typed))
  await sleep(1500)
  await drive.evaluate(`window.__probeLong = []; window.__probeObs = new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__probeLong.push(e.duration) }); window.__probeObs.observe({ type: 'longtask' })`)
  await search('')
  await sleep(4000)
  results.clearSearch = JSON.parse(String(await drive.evaluate(`JSON.stringify({ longestMs: Math.round(Math.max(0, ...window.__probeLong)), sumMs: Math.round(window.__probeLong.reduce((a, b) => a + b, 0)), rowsMounted: document.querySelectorAll('.lc-convrow').length })`)))
  say(`clear search: ${JSON.stringify(results.clearSearch)}`)

  // The stand-in or nothing.
  // Discovery can still be running here, behind a long history's read: wait for its answer about Claude Code.
  let seen = '[]'
  for (let i = 0; i < 120 && seen === '[]'; i += 1) {
    seen = String(await drive.evaluate(`window.desktop.discoveryLog().then((log) => JSON.stringify(log.filter((e) => e.kind === 'probe.finished' && e.id === 'claude').map((e) => e.version ?? null)))`))
    if (seen === '[]') await sleep(500)
  }
  say(`Claude Code as the app found it: ${seen}`)
  if (!seen.includes(FAKE_VERSION)) throw new Error(`the app did not find the stand-in claude (it read ${seen}); nothing was sent`)
  const sent = String(await drive.evaluate(`(async () => {
    const card = [...document.querySelectorAll('.lc-hometeam__card')].find((c) => c.getAttribute('aria-label')?.startsWith('Message Wren'))
    if (!card) return 'no Wren card'
    card.click()
    await new Promise((r) => setTimeout(r, 800))
    const field = document.querySelector('form.command-dock textarea')
    if (!field) return 'no composer'
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Write a long story about locusts crossing a field. Do not use tools or change files.')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 250))
      const button = document.querySelector('button[aria-label="Send"]')
      if (button && !button.disabled) { button.click(); return 'sent' }
    }
    return 'Send never enabled'
  })()`))
  if (sent !== 'sent') throw new Error(sent)
  // Into the reply: the stand-in streams for over a minute at these settings.
  for (let i = 0; i < 60; i += 1) {
    await sleep(500)
    if (Number(await drive.evaluate(`[...document.querySelectorAll('.lc-agentline__body')].reduce((n, e) => n + e.innerText.length, 0)`)) > 2000) break
  }
  const windows = []
  for (let round = 0; round < 2; round += 1) {
    await drive.evaluate(`(() => {
      // Its own object: the first window's loop must not count into the second's.
      const f = { on: true, gaps: [], last: performance.now() }
      window.__frames = f
      const tick = (now) => { if (!f.on) return; f.gaps.push(now - f.last); f.last = now; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      window.__probeLong = []
    })()`)
    await sleep(10_000)
    const measured = JSON.parse(String(await drive.evaluate(`(() => {
      const f = window.__frames; f.on = false
      const gaps = f.gaps.slice(1).sort((a, b) => a - b)
      const pick = (q) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] ?? 0)
      return JSON.stringify({ frames: gaps.length, gapP50Ms: pick(0.5), gapP95Ms: pick(0.95), blockedMs: Math.round(window.__probeLong.reduce((a, b) => a + b, 0)), streaming: Boolean(document.querySelector('button[aria-label^="Stop the running"]')) })
    })()`)))
    windows.push(measured)
    say(`stream window ${String(round + 1)}: ${JSON.stringify(measured)}`)
  }
  results.stream = windows
  results.rowsAtEnd = Number(await drive.evaluate(`document.querySelectorAll('.lc-convrow').length`))
  // Scrolled to the end, the list draws its next page by itself.
  for (let round = 0; round < 3; round += 1) {
    await drive.evaluate(`(() => { const box = document.querySelector('.lc-sidebar__scroll'); box.scrollTop = box.scrollHeight; return box.scrollTop })()`)
    await sleep(800)
  }
  results.rowsAfterScrolling = Number(await drive.evaluate(`document.querySelectorAll('.lc-convrow').length`))
  results.moreSays = String(await drive.evaluate(`document.querySelector('.lc-listmore')?.textContent ?? 'none'`))
  say(`after scrolling: ${String(results.rowsAfterScrolling)} rows, end says ${results.moreSays}`)
  await drive.capture('the end of the list drawn so far', async () => results.moreSays)
  await drive.evaluate(`(() => { const box = document.querySelector('.lc-sidebar__scroll'); box.scrollTop = 0; return 0 })()`)
  await drive.capture('the top of the list', async () => String(results.rowsAfterScrolling))
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2))
  say(`RESULTS ${JSON.stringify(results)}`)
} finally {
  await drive.finish({ intro: `Long history (${String(conversations)} conversations) while a reply streams. Build: ${packaged ?? 'out/'}.`, extra: JSON.stringify(results, null, 2) })
}
