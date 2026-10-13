// LOCUST'S HOURS ON ITS CLOUD COMPUTERS (0.769), the way a person meets them: Settings > Cloud computers, with the
// count kept in the profile's cloud-turns.json -- about how many this month, against what GitHub includes, on a
// meter, with GitHub's exact count a click away -- and each computer's own share on its card.
//
//   node _tools/drive-cloud-hours-are-shown.mjs [--packaged <exe>]
//
// Spends nothing: the hours are seeded (80 minutes of turns ending 50 minutes ago, so 90 with the idle tail), and
// GitHub is only asked to list the computers. It needs Locust's cloud computer for locust-cloud-test to exist.

import { execFile } from 'node:child_process'
import { join } from 'node:path'

import { recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const packaged = arg('--packaged')
const gh = (args) => new Promise((resolve) => {
  execFile('gh', args, { windowsHide: true, timeout: 60_000 }, (error, stdout) => resolve(error ? '' : String(stdout)))
})
const listed = JSON.parse((await gh(['codespace', 'list', '--repo', 'automatedworkflowllc-design/locust-cloud-test', '--json', 'name,displayName'])) || '[]')
const name = listed.find((space) => space.displayName === 'locust-locust-cloud-test')?.name
if (name === undefined) {
  say('no cloud computer for locust-cloud-test: make one first (drive-a-cloud-turn.mjs --keep)')
  process.exit(2)
}
const ago = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
const month = new Date().toISOString().slice(0, 7)

const drive = await startDrive({
  name: 'cloud-hours-are-shown', port: 9652, workspace: await scratchRepository('locust-drive-hours-ws-'), sendsNothing: true,
  outPath: join(recordRoot('cloud-hours-are-shown-2026-10-13'), packaged === undefined ? 'local' : 'packaged'),
  ...(packaged === undefined ? {} : { packaged }),
  files: { 'cloud-turns.json': { tasks: {}, turns: {}, agents: {}, use: { [month]: { [name]: [[ago(130), ago(50)]] } }, useSince: ago(130) } },
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'blue', role: 'Code & Migrations', createdAt: '2026-10-13T15:00:00.000Z', route: { runtime: 'opencode', model: 'opencode/space-bunny-free', mode: 'accept-edits' } }], missionOwners: {}, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})

let failures = 0
const check = (what, ok, detail) => {
  if (!ok) failures += 1
  say(`  [${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${String(detail).slice(0, 400)}`}`)
}
const text = (selector) => drive.evaluate(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '').replace(/\\s+/g, ' ').trim()`)

try {
  await drive.ready()
  await drive.resize(1215, 860)
  say(`  settings: ${String(await drive.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((one) => one.innerText.trim() === 'Settings'); if (!button) return 'no settings'; button.click(); return 'opened' })()`))}`)
  await sleep(800)
  say(`  page: ${String(await drive.evaluate(`(() => { const item = [...document.querySelectorAll('.lc-settings__navitem')].find((one) => one.innerText.trim().startsWith('Cloud computers')); if (!item) return 'no page'; item.click(); return 'clicked' })()`))}`)
  for (let second = 0; second < 60 && !(await drive.evaluate(`Boolean(document.querySelector('.lc-cloudhours'))`)); second += 1) await sleep(1000)
  const hours = String(await drive.capture("Settings > Cloud computers: Locust's hours this month", () => text('.lc-cloudhours')))
  check('the hours say about how many this month, against what GitHub includes', /About 1\.5 hours of the 60 GitHub includes free, or 90 with Pro/.test(hours) && /Exact hours on GitHub/.test(hours) && /count only on GitHub/.test(hours), hours)
  const meter = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => { const bar = document.querySelector('.lc-cloudhours__meter'); const fill = document.querySelector('.lc-cloudhours__fill'); return { now: bar?.getAttribute('aria-valuenow'), of: bar?.getAttribute('aria-valuemax'), width: fill === null || bar === null ? 0 : fill.getBoundingClientRect().width / bar.getBoundingClientRect().width } })())`)))
  check('the meter reads 1.5 of 60, and fills that much of itself', meter.now === '1.5' && meter.of === '60' && meter.width > 0.02 && meter.width < 0.03, JSON.stringify(meter))
  const card = String(await text('.lc-cloudcomputer'))
  check("the computer's card says its own share", /About 1\.5 hours this month, by Locust's count\./.test(card), card)
  // The smallest window Locust allows, and a big screen: the meter keeps one line of words and its bar.
  for (const [width, height, where] of [[1120, 720, 'the smallest window'], [1920, 1080, 'a big screen']]) {
    await drive.resize(width, height)
    await sleep(500)
    const fit = JSON.parse(String(await drive.capture(`The hours, at ${where}`, () => drive.evaluate(`JSON.stringify((() => { const box = document.querySelector('.lc-cloudhours'); const line = document.querySelector('.lc-cloudhours__line'); const bold = document.querySelector('.lc-cloudhours__hours'); const head = document.querySelector('.lc-cloudhours__head'); return { lines: line === null || bold === null ? 0 : (line.getBoundingClientRect().height < 1.6 * bold.getBoundingClientRect().height ? 1 : 2), head: head === null ? 0 : Math.round(head.getBoundingClientRect().height), overflows: box === null ? true : box.scrollWidth > box.clientWidth } })())`))))
    check(`at ${where}, the count stays on one line and nothing spills`, fit.lines === 1 && fit.head <= 40 && !fit.overflows, JSON.stringify(fit))
  }
} catch (error) {
  failures += 1
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: `Build: ${packaged ?? 'out/'}. Hours seeded for ${name}: 80 minutes ending 50 minutes ago.`, extra: `Checks failed: ${String(failures)}` })
  process.exit(failures === 0 ? 0 : 1)
}
