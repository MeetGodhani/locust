// The board's layout proof: real saved questions, no agent process or model turn.
// Run through drive-team-board.mjs --seeded. The older live-state drive stays available.
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFileMissionLedger } from '../packages/mission-store/dist/index.js'
import { createCodexEventNormalizer } from '../packages/runtime-adapters/dist/index.js'
import { FREE_ROUTE, recordRoot, say, scratchRepository, sleep, startDrive } from './drive-lib.mjs'

const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined
const workspace = await scratchRepository('locust-team-board-seeded-')
const workspaceId = `ws_${createHash('sha256').update(workspace).digest('hex').slice(0, 32)}`
const question = 'How should we handle the two billing paths while we migrate?'
const control = process.argv.includes('--negative-control')
const answer = `<locust-ask>\n${question}\n- Keep both paths :: Smaller change during migration.\n- Migrate both now :: Larger change, one path afterwards.\n</locust-ask>`
const ago = (ms) => new Date(Date.now() - ms).toISOString()
const team = [
  { teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: ago(4 * 86400_000), route: FREE_ROUTE },
  { teammateId: 'tm_juno', name: 'Juno', hue: 'violet', role: 'Docs & QA', createdAt: ago(4 * 86400_000), route: FREE_ROUTE },
  { teammateId: 'tm_quill', name: 'Quill', hue: 'clay', role: 'Research & Briefs', createdAt: ago(4 * 86400_000), route: FREE_ROUTE }
]
const profilePath = await mkdtemp(join(tmpdir(), 'locust-team-board-profile-'))
const ledger = createFileMissionLedger({ rootDirectory: join(profilePath, 'mission-ledger') })
const record = async (missionId, prompt, text, at) => {
  const runId = `run_${missionId}`
  await ledger.createMission({ missionId, runId, prompt, runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId, sandbox: 'read-only', executionPolicyVersion: 1, createdAt: at })
  const normalizer = createCodexEventNormalizer({ runId, missionId, requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: 'fixture', now: () => new Date(at) })
  await ledger.appendEvents(missionId, [
    ...normalizer.accept({ sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: `thread_${missionId}` }) }),
    ...normalizer.accept({ sequence: 2, raw: JSON.stringify({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } }) }),
    ...normalizer.accept({ sequence: 3, raw: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 100 } }) }),
    ...normalizer.finish({ exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 3, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: at, finishedAt: at })
  ])
}
await record('m_wait', 'Review the billing migration', answer, ago(15 * 60_000))
await record('m_old', 'Read the release notes', 'The release notes are ready.', ago(3 * 86400_000))
const drive = await startDrive({
  name: 'team-board-seeded', port: 9683, workspace, profilePath, sendsNothing: true, holdCursor: false,
  outPath: join(recordRoot('team-board-2026-10-19'), arg('--tag') ?? 'seeded'),
  ...(arg('--packaged') === undefined ? {} : { packaged: arg('--packaged') }),
  seed: { schemaVersion: 1, teammates: team, missionOwners: { m_wait: 'tm_wren', m_old: 'tm_juno' }, settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false } }
})
let checks = 0
let failures = 0
const check = (what, ok, detail) => {
  checks += 1
  if (!ok) failures += 1
  say(`[${ok ? 'PASS' : 'FAIL'}] ${what}${detail === undefined ? '' : ` -- ${JSON.stringify(detail)}`}`)
}
const read = () => drive.evaluate(`(() => {
  const card = document.querySelector('.lc-boardsection--needs-you .lc-rostercard')
  const actions = card?.querySelector('.lc-rostercard__actions')
  const question = card?.querySelector('.lc-rostercard__question')
  const team = document.querySelector('.lc-faces__team')
  const ages = [...document.querySelectorAll('.lc-rostercard__stats')].map((stats) => {
    const value = stats.querySelectorAll('dd')[1]
    const range = document.createRange(); range.selectNodeContents(value)
    return { text: value.textContent, fits: value.scrollWidth <= value.clientWidth && value.scrollHeight <= value.clientHeight && range.getBoundingClientRect().right <= value.getBoundingClientRect().right + 1, overflow: getComputedStyle(value).textOverflow }
  })
  return JSON.stringify({ ages, question: question?.textContent, lines: question ? question.clientHeight / parseFloat(getComputedStyle(question).lineHeight) : 0,
    actions: actions ? getComputedStyle(actions).opacity : null, current: team?.getAttribute('aria-current'),
    selected: team ? !['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(team).backgroundColor) : false,
    actionCount: actions?.querySelectorAll('button').length, answerCount: card?.querySelectorAll('.lc-rostercard__waiting').length,
    overflow: document.querySelector('.lc-teamboard')?.scrollWidth > document.querySelector('.lc-teamboard')?.clientWidth,
    theme: document.documentElement.dataset.theme })
})()`)
try {
  await drive.ready()
  await drive.waitFor(`document.querySelector('.lc-hometeam__role.is-doing')?.textContent === ${JSON.stringify(question)}`, { what: 'Home’s saved waiting question' })
  check('Home reads the seeded waiting question', true)
  await drive.evaluate(`document.querySelector('.lc-faces__team').click()`)
  await drive.waitForSelector('.lc-teamboard')
  // The old drawn rules must fail the same checks, without changing source,
  // the built app, or the saved profile. Only this throwaway window is changed.
  if (control) await drive.evaluate(`(() => {
    const style = document.createElement('style')
    style.textContent = '.lc-rostercard__stats { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } .lc-rostercard__stat dd { overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; } .lc-teamboard .lc-rostercard__actions { opacity: 0 !important; }'
    document.head.append(style)
    document.querySelector('.lc-rostercard__waiting').remove()
    document.querySelector('.lc-faces__team').removeAttribute('aria-current')
  })()`)
  for (const theme of control ? ['dark'] : ['dark', 'light']) {
    await drive.evaluate(`window.desktop.setTheme(${JSON.stringify(theme)})`)
    for (const [width, height] of control ? [[1440, 900]] : [[1440, 900], [1205, 803]]) {
      await drive.resize(width, height)
      await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: width - 5, y: height - 5 })
      await sleep(250)
      const state = JSON.parse(String(await read()))
      await drive.capture(`${theme} Team ${width} by ${height}`, () => JSON.stringify(state))
      check(`${theme} ${width}: Last run reads whole`, state.ages.some((age) => age.text === '15 minutes ago') && state.ages.some((age) => age.text === '3 days ago') && state.ages.every((age) => age.fits && age.overflow !== 'ellipsis'), state.ages)
      check(`${theme} ${width}: Home’s question, two lines and one Answer`, state.question === question && state.lines > 0 && state.lines <= 2.05 && state.answerCount === 1, state)
      check(`${theme} ${width}: all three actions visible at rest`, Number(state.actions) > 0 && Number(state.actions) < 1 && state.actionCount === 3, state.actions)
      check(`${theme} ${width}: Team is current without board overflow`, state.current === 'page' && state.selected && !state.overflow && state.theme === theme, state.current)
    }
  }
  if (!control) {
    const box = JSON.parse(String(await drive.evaluate(`JSON.stringify((() => { const b = document.querySelector('.lc-boardsection--needs-you .lc-rostercard').getBoundingClientRect(); return { x: b.x + 10, y: b.y + 10 } })())`)))
    await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...box })
    await sleep(180)
    check('hover brings the actions to full opacity', JSON.parse(String(await read())).actions === '1')
    await drive.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1200, y: 798 })
    await drive.evaluate(`document.querySelector('.lc-rostercard__message').focus()`)
    await sleep(180)
    check('keyboard focus brings the actions to full opacity', JSON.parse(String(await read())).actions === '1')
    await drive.capture('keyboard focus on Message', () => read())
    await drive.evaluate(`document.querySelector('.lc-rostercard__waiting').click()`)
    await drive.waitForSelector('.lc-decision')
    check('Answer opens the waiting conversation and its choice card', Boolean(await drive.evaluate(`document.body.innerText.includes(${JSON.stringify(question)}) && document.body.innerText.includes('Keep both paths')`)))
    check('Team is not current in the conversation', await drive.evaluate(`document.querySelector('.lc-faces__team')?.getAttribute('aria-current') === null`))
    await drive.capture('Answer opens the billing conversation', () => 'The saved question is shown; no reply was sent.')
  }
  check('the captured frames have no renderer errors', drive.record.every((frame) => frame.errors.length === 0))
} catch (error) {
  check('drive completes', false, error instanceof Error ? error.message : String(error))
  await drive.capture('drive failure', () => drive.evaluate(`document.body.innerText`))
} finally {
  say(`TEAM BOARD SEEDED: ${checks - failures}/${checks} passed`)
  await drive.finish({ intro: 'Synthetic saved question and completed conversation; both themes at 1440x900 and 1205x803. No agent process, model turn, sign-in or global configuration change.' })
  if (failures > 0) process.exitCode = 1
}
