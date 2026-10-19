// With OpenCode 2 installed, Locust says it is not supported yet (0.805), instead of failing every turn.
//
//   LOCUST_DRIVE_PATH_FIRST=<folder holding OpenCode 2's opencode.exe> node _tools/probe-opencode-2-says-not-yet.mjs
//
// MEASURED 2026-10-19 with OpenCode 2.0.32 first on PATH: before 0.805, OpenCode read as ready and every turn ended
// "OpenCode's event stream closed before the turn finished". Spends nothing and sends nothing: it reads what Home's
// Connected accounts says about OpenCode.

import { say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

if (process.env.LOCUST_DRIVE_PATH_FIRST === undefined) {
  say('needs LOCUST_DRIVE_PATH_FIRST: the folder holding OpenCode 2')
  process.exit(2)
}
let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${detail}`}`)
}
const drive = await startDrive({
  name: 'opencode-2-says-not-yet',
  port: 9646,
  workspace: await scratchRepository('locust-opencode-2-ws-'),
  sendsNothing: true,
  seed: { schemaVersion: 1, teammates: [], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
try {
  await drive.ready()
  await drive.resize(1440, 900)
  // Discovery answers on its own clock; OpenCode is the slowest to start. Home's Connected accounts is where the
  // person first sees it.
  let row = { text: '', hover: '' }
  for (let second = 0; second < 60 && !/not supported yet/i.test(row.text); second += 2) {
    await sleep(2000)
    row = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => {
      const cell = [...document.querySelectorAll('.lc-runtimecell')].find((el) => /OpenCode/.test(el.querySelector('.lc-runtimecell__name')?.textContent ?? ''))
      return { text: (cell?.innerText ?? '').replace(/\\s+/g, ' ').trim(), hover: cell?.querySelector('.lc-runtimecell__need')?.getAttribute('title') ?? '' }
    })())`)))
  }
  await drive.capture('Home, Connected accounts, with OpenCode 2 installed', () => Promise.resolve(JSON.stringify(row)))
  check('the OpenCode row says it is not supported yet', /not supported yet/i.test(row.text) && !/Ready/.test(row.text), row.text)
  check('and its hover says why and what to do', /OpenCode 1 for now/.test(row.hover) && /npm install -g opencode-ai/.test(row.hover), row.hover.slice(0, 300))
} catch (error) {
  failures += 1
  say(`probe failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'OpenCode 2.0.32 first on PATH; Home read for what it says about OpenCode.' })
}
say(failures === 0 ? 'OPENCODE 2 SAYS NOT YET: PASSED' : `${String(failures)} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
