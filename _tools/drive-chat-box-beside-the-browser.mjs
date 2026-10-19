// The chat box beside the browser (0.800): two rows at most, Send at the end of the last, nothing past the box.
//
//   node _tools/drive-chat-box-beside-the-browser.mjs [--packaged <exe>]
//
// With the browser open the box is ~380px, and its controls ran to three rows with Send alone on the third
// (point-at-the-browser frames, 0.798). Measured for a free OpenCode teammate and a Claude teammate, whose effort
// chip makes the row longer. Nothing is sent.

import { join } from 'node:path'

import { FREE_ROUTE, openTeammateScript, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const at = '2026-10-19T05:00:00.000Z'
const drive = await startDrive({
  ...(packaged === undefined ? {} : { packaged }),
  name: 'chat-box-beside-the-browser',
  port: 9643,
  workspace: await scratchRepository('locust-drive-box-browser-ws-'),
  outPath: join(recordRoot('chat-box-beside-the-browser-2026-10-19'), packaged === undefined ? 'local' : 'packaged'),
  sendsNothing: true,
  seed: {
    schemaVersion: 1,
    teammates: [
      { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: at, route: FREE_ROUTE },
      { teammateId: 'tm_ada', name: 'Ada', hue: 'violet', role: 'Docs & QA', createdAt: at, route: { runtime: 'claude', model: 'account-default', mode: 'accept-edits', effort: 'high' } }
    ],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 600)}`}`)
}

const MEASURE = `(() => {
  const box = document.querySelector('.lc-composer__inner')
  const row = document.querySelector('.lc-composer__controls')
  if (box === null || row === null) return JSON.stringify({ found: false })
  const edge = box.getBoundingClientRect()
  // What is drawn on the row: not a menu's items, which sit in the row's markup while closed.
  const parts = [...row.querySelectorAll('button, .lc-control')].filter((el) => el.getBoundingClientRect().width > 0 && el.closest('[role="menu"]') === null && getComputedStyle(el).visibility !== 'hidden')
  // A row by the middles of what is on it: chips of different heights on one row have different tops.
  const middles = parts.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }).sort((a, b) => a - b)
  const tops = middles.filter((middle, i) => i === 0 || middle - middles[i - 1] > 12)
  const send = row.querySelector('.lc-send')?.getBoundingClientRect()
  const last = parts.reduce((max, el) => Math.max(max, Math.round(el.getBoundingClientRect().right)), 0)
  const sendMiddle = send === undefined ? 0 : send.top + send.height / 2
  const onLastRow = parts.filter((el) => { const r = el.getBoundingClientRect(); return Math.abs(r.top + r.height / 2 - sendMiddle) <= 12 && el !== row.querySelector('.lc-send') }).length
  return JSON.stringify({
    found: true,
    box: Math.round(edge.width),
    rows: tops.length,
    pastEdge: Math.max(0, last - Math.round(edge.right), Math.round(edge.left) - parts.reduce((min, el) => Math.min(min, Math.round(el.getBoundingClientRect().left)), Infinity)),
    sendLast: send !== undefined && Math.round(send.right) >= last - 1,
    sendAlone: onLastRow === 0,
    chips: parts.map((el) => (el.getAttribute('aria-label') || el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 28)).join(' | ')
  })
})()`

try {
  await drive.capture('launch', () => drive.ready())
  await drive.resize(1205, 803)
  await sleep(800)
  await drive.evaluate(`document.querySelector('button[aria-label="Browser"]')?.click()`)
  await drive.waitFor(`document.querySelector('.lc-browser__tabs') !== null`, { timeoutMs: 8_000 }).catch(() => undefined)
  for (const name of ['Wren', 'Ada']) {
    await drive.evaluate(openTeammateScript(name))
    await sleep(1200)
    const measured = JSON.parse(String(await drive.capture(`${name}'s chat box beside the browser`, () => drive.evaluate(MEASURE))))
    say(JSON.stringify(measured))
    check(`${name}: the box is narrow (the browser is open)`, measured.found && measured.box < 520, measured.box)
    check(`${name}: two rows at most`, measured.rows <= 2, measured.rows)
    check(`${name}: nothing past the box`, measured.pastEdge === 0, `${String(measured.pastEdge)}px`)
    check(`${name}: Send is last, and not alone on its row`, measured.sendLast && !measured.sendAlone, measured.chips)
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'whatever pnpm build last wrote to out/'}. The chat box at 1205x803 with the browser open, for a free OpenCode teammate and a Claude teammate. Nothing sent.` })
}
say(failures === 0 ? 'ALL PASSED' : `${String(failures)} FAILED`)
process.exit(failures === 0 ? 0 : 1)
