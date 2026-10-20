// The design pass's own changes, on screen (2026-10-19): the + menu's words, the decision card's keys and focus, and
// Share your team closing on Escape. Saved conversations only: no agent process, model turn or sign-in.
//
//   node _tools/drive-design-pass-cards.mjs [--packaged <exe>] [--tag <name>]
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileMissionLedger } from '../packages/mission-store/dist/index.js'
import { createCodexEventNormalizer } from '../packages/runtime-adapters/dist/index.js'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const workspace = await scratchRepository('locust-design-pass-cards-')
const workspaceId = `ws_${createHash('sha256').update(workspace).digest('hex').slice(0, 32)}`
const question = 'How should we handle the two billing paths while we migrate?'
const answer = `<locust-ask>\n${question}\n- Keep both paths :: Smaller change during migration.\n- Migrate both now :: Larger change, one path afterwards.\n</locust-ask>`
const ago = (ms) => new Date(Date.now() - ms).toISOString()
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: ago(4 * 86400_000), route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: ago(4 * 86400_000), route: FREE_ROUTE }
]
const profilePath = await mkdtemp(join(tmpdir(), 'locust-design-pass-profile-'))
const ledger = createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })
const missionId = 'm_wait'
const runId = `run_${missionId}`
const at = ago(15 * 60_000)
await ledger.createMission({ missionId, runId, prompt: 'Review the billing migration', runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at })
const normalizer = createCodexEventNormalizer({ runId, missionId, requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: 'fixture', now: () => new Date(at) })
await ledger.appendEvents(missionId, [
  ...normalizer.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: `thread_${missionId}` }) }),
  ...normalizer.accept({ sequence: 2, raw: JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: answer } }) }),
  ...normalizer.accept({ sequence: 3, raw: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 100 } }) }),
  ...normalizer.finish({ exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: at, finishedAt: at })
])
const drive = await startDrive({
  name: 'design-pass-cards', port: 9687, workspace, profilePath, sendsNothing: true, holdCursor: false,
  outPath: join(recordRoot('design-pass-2026-10-19'), arg('--tag') ?? 'local'),
  ...(arg('--packaged') === undefined ? {} : { packaged: arg('--packaged') }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: { m_wait: 'tm_wren' }, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let checks = 0
let failures = 0
const check = (what, ok, detail) => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`)
}
const SIZES = [[1440, 900], [1205, 803]]
const key = (name, code, keyCode) => Promise.all(['keyDown', 'keyUp'].map((type) => drive.send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: keyCode })))
const plusState = () => drive.evaluate(`JSON.stringify((() => {
  const box = document.querySelector('.lc-composer__box') ?? document.querySelector('form.command-dock')
  const inside = box?.getBoundingClientRect()
  return [...document.querySelectorAll('.lc-plusmenu__label')].map((label) => {
    const r = label.getBoundingClientRect()
    const droplet = document.querySelector('.lc-plusmenu__satellite[data-satellite="' + label.dataset.satellite + '"]').getBoundingClientRect()
    return { text: label.textContent, opacity: getComputedStyle(label).opacity, clear: r.left >= droplet.right + 4,
      overlapsOther: [...document.querySelectorAll('.lc-plusmenu__satellite')].some((d) => { const o = d.getBoundingClientRect(); return !(r.right <= o.left || r.left >= o.right || r.bottom <= o.top || r.top >= o.bottom) }),
      inBox: inside === undefined || (r.right <= inside.right && r.top >= inside.top - 80) }
  })
})())`)
const decisionState = () => drive.evaluate(`JSON.stringify((() => {
  const card = document.querySelector('.lc-decision')
  const keyEl = card?.querySelector('.lc-decision__key')
  const style = keyEl ? getComputedStyle(keyEl) : null
  return { focused: document.activeElement === card, optionFocused: document.activeElement?.classList.contains('lc-decision__option') ?? false,
    keyBorder: style?.borderTopWidth, keyHeight: keyEl?.getBoundingClientRect().height, shadow: card ? getComputedStyle(card).boxShadow !== 'none' : false,
    border: card ? getComputedStyle(card).borderLeftColor : null }
})())`)
try {
  await drive.ready()
  await drive.waitFor(`document.querySelector('.lc-hometeam__role.is-doing')?.textContent === ${JSON.stringify(question)}`, { what: 'Home’s saved waiting question' })

  // The + menu, open, in both themes and sizes.
  for (const theme of ['dark', 'light']) {
    await drive.evaluate(`window.desktop.setTheme(${JSON.stringify(theme)})`)
    for (const [width, height] of SIZES) {
      await drive.resize(width, height)
      await sleep(300)
      await drive.evaluate(`document.querySelector('.lc-plusmenu__main').click()`)
      await sleep(900)
      const labels = JSON.parse(String(await plusState()))
      await drive.capture(`${theme} plus menu open ${width} by ${height}`, () => JSON.stringify(labels))
      check(`${theme} ${width}: each droplet says what it does`, labels.length === 2 && labels.every((label) => label.opacity === '1' && label.clear && !label.overlapsOther), labels)
      await key('Escape', 'Escape', 27)
      await sleep(500)
      check(`${theme} ${width}: Escape puts the words away`, JSON.parse(String(await plusState())).every((label) => label.opacity === '0'))
    }
  }

  // Share your team: Escape closes it, and focus is held inside while open.
  await drive.evaluate(`document.querySelector('.lc-faces__team').click()`)
  await drive.waitForSelector('.lc-teamboard')
  await drive.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Share team').click()`)
  await drive.waitForSelector('.lc-shareteam')
  await sleep(300)
  check('Share your team takes the focus in', Boolean(await drive.evaluate(`document.querySelector('.lc-shareteam').contains(document.activeElement)`)))
  check('Share your team has an x', Boolean(await drive.evaluate(`!!document.querySelector('.lc-shareteam .lc-dialog__close')`)))
  await drive.capture('Share your team, open', () => drive.evaluate(`document.querySelector('.lc-shareteam').innerText`))
  await key('Escape', 'Escape', 27)
  await sleep(300)
  check('Escape closes Share your team', Boolean(await drive.evaluate(`!document.querySelector('.lc-shareteam')`)))

  // The decision card: the card holds the focus, no option looks chosen, the numbers are keys.
  await drive.evaluate(`document.querySelector('.lc-rostercard__waiting').click()`)
  await drive.waitForSelector('.lc-decision')
  await sleep(500)
  for (const theme of ['dark', 'light']) {
    await drive.evaluate(`window.desktop.setTheme(${JSON.stringify(theme)})`)
    for (const [width, height] of SIZES) {
      await drive.resize(width, height)
      await sleep(300)
      const state = JSON.parse(String(await decisionState()))
      await drive.capture(`${theme} decision card ${width} by ${height}`, () => JSON.stringify(state))
      check(`${theme} ${width}: no option looks chosen, and each number is a key`, !state.optionFocused && state.keyBorder === '1px' && state.keyHeight >= 17 && state.shadow, state)
    }
  }
  check('the card itself took the focus', JSON.parse(String(await decisionState())).focused)
  await key('Tab', 'Tab', 9)
  await sleep(200)
  await drive.capture('Tab reaches option 1', () => decisionState())
  check('Tab still reaches option 1', JSON.parse(String(await decisionState())).optionFocused)
  check('the captured frames have no renderer errors', drive.record.every((frame) => frame.errors.length === 0))
} catch (error) {
  check('drive completes', false, error instanceof Error ? error.message : String(error))
  await drive.capture('drive failure', () => drive.evaluate(`document.body.innerText`))
} finally {
  say(`DESIGN PASS CARDS: ${checks - failures}/${checks} passed`)
  await drive.finish({ intro: 'Saved conversations only; both themes at 1440x900 and 1205x803. No agent process, model turn, sign-in or global configuration change.' })
  if (failures > 0) process.exitCode = 1
}
