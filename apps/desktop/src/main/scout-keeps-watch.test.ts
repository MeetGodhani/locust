import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FolderPullRequest } from '../shared/pull-request.js'
import type { ScoutState, WaitingCard } from '../shared/scout.js'
import { createScout, type ScoutDeps, type ScoutGithub } from './scout.js'

/*
 * SCOUT KEEPS WATCH (0.756). One look at a time, on its timer while it is on: Locust's own facts become cards at
 * once, in Locust's words; only then is Scout's model asked, in one turn on Scout's own route, and its take and drafted
 * next step fill the cards in when that turn ends. A look with nothing new asks no model, a fact is told once, a model
 * that does not answer leaves the cards as they were and says why, and nothing on a card happens on its own.
 */
const roots: string[] = []
// With retries: a look's last save can still be landing as a test ends, and Windows will not remove a folder while a
// file in it is being replaced (ENOTEMPTY on the 0.757 CI's windows runner, 2026-10-12).
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))) })

const URL = 'https://github.com/acme/app/pull/212'
const pr = (change: Partial<FolderPullRequest> = {}): FolderPullRequest => ({ number: 212, title: 'Talk starts from any app', url: URL, state: 'open', checks: 'passing', checkCount: 9, notPassed: 0, ...change })

async function harness(overrides: Partial<ScoutDeps> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'locust-scout-'))
  roots.push(root)
  let github: ScoutGithub | undefined = { prs: [], reviews: [] }
  let waiting: WaitingCard[] = []
  let clock = new Date('2026-10-12T06:00:00.000Z')
  const asked: string[] = []
  const models: (string | undefined)[] = []
  const stopped: string[] = []
  const answers = new Map<string, { text: string } | { failed: string }>()
  const changes: ScoutState[] = []
  const notified: string[] = []
  const teammates = new Set<string>()
  let made = 0
  const deps: ScoutDeps = {
    file: join(root, 'scout.json'),
    now: () => clock,
    github: async () => github,
    waiting: async () => waiting,
    failedTurn: async (missionId) => missionId.startsWith('failed_') ? { missionId, teammateId: 'tm_wren', name: 'Wren', asked: 'Fix the save', why: 'The model is overloaded.' } : undefined,
    team: async () => [{ teammateId: 'tm_scout_1', name: 'Scout', role: 'Keeps watch' }, { teammateId: 'tm_wren', name: 'Wren', role: 'Code & Migrations' }],
    ask: async (_teammateId, prompt, model) => { asked.push(prompt); models.push(model); return { missionId: `look_${String(asked.length)}`, runId: `run_${String(asked.length)}` } },
    stop: (runId) => { stopped.push(runId) },
    nextFreeModel: async (_teammateId, tried) => ['opencode/longcat-2.5-preview-free', 'opencode/nemotron-3-ultra-free'].find((id) => !tried.includes(id)),
    answerOf: async (missionId) => answers.get(missionId) ?? { failed: 'It said nothing.' },
    makeTeammate: async () => { made += 1; const id = `tm_scout_${String(made)}`; teammates.add(id); return id },
    teammateExists: async (id) => teammates.has(id),
    changed: (state) => { changes.push(state) },
    notify: (card) => { notified.push(card.said) },
    schedule: () => 'timer',
    clear: () => undefined,
    ...overrides
  }
  const scout = createScout(deps)
  return {
    scout, deps, asked, answers, changes, notified, teammates, models, stopped,
    setGithub: (next: ScoutGithub | undefined) => { github = next },
    setWaiting: (next: WaitingCard[]) => { waiting = next },
    tick: (ms: number) => { clock = new Date(clock.getTime() + ms) },
    made: () => made
  }
}

describe('Scout, turned on', () => {
  it('joins the team on the route it was given, once, and looks at once', async () => {
    const h = await harness()
    h.setGithub({ prs: [pr({ checks: 'failing', notPassed: 2 })], reviews: [] })
    const route = { runtime: 'opencode', model: 'opencode/space-bunny-free' }
    const state = await h.scout.turnOn(route)
    expect(h.made()).toBe(1)
    expect('settings' in state && state.settings).toMatchObject({ on: true, teammateId: 'tm_scout_1' })
    expect(h.asked).toHaveLength(1)
    // Off and on again: the same Scout, not a second one.
    await h.scout.set({ on: false })
    await h.scout.turnOn(route)
    expect(h.made()).toBe(1)
  })

  it('says why when it cannot join the team', async () => {
    const h = await harness({ makeTeammate: async () => { throw new Error('A teammate named Scout is already on the team.') } })
    expect(await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })).toEqual({ refused: 'A teammate named Scout is already on the team.' })
  })
})

describe('a look', () => {
  it('makes cards in Locust’s words at once, then fills them in from its model’s answer', async () => {
    const h = await harness()
    h.setGithub({ prs: [pr({ checks: 'failing', notPassed: 2 })], reviews: [] })
    const looked = await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    const card = 'cards' in looked ? looked.cards[0] : undefined
    expect(card).toMatchObject({ said: 'Your pull request #212, Talk starts from any app: 2 of 9 checks did not pass.', reading: true, urgency: 'now' })
    expect(h.asked[0]).toContain('1. Your pull request #212')
    // Scout itself is not on the team it hands work to.
    expect(h.asked[0]).toContain('- Wren, Code & Migrations')
    expect(h.asked[0]).not.toContain('- Scout')
    expect((await h.scout.state()).lookIds).toEqual(['look_1'])
    h.answers.set('look_1', { text: 'ITEM 1\nTAKE: Wren changed that test this morning.\nHAND TO: Wren\nDRAFT: Fix the Mac timeout on #212.' })
    await h.scout.onRunEnded({ missionId: 'look_1' })
    const after = (await h.scout.state()).cards[0]
    expect(after).toMatchObject({ take: 'Wren changed that test this morning.', draft: { teammateId: 'tm_wren', name: 'Wren', message: 'Fix the Mac timeout on #212.' } })
    expect(after).not.toHaveProperty('reading')
  })

  it('asks no model when nothing is new, and tells a fact once', async () => {
    const h = await harness()
    h.setGithub({ prs: [pr({ checks: 'failing', notPassed: 2 })], reviews: [{ number: 214, title: 'Rename the call log', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    expect(h.asked).toHaveLength(1)
    h.answers.set('look_1', { text: 'ITEM 1\nTAKE: Read it.' })
    await h.scout.onRunEnded({ missionId: 'look_1' })
    await h.scout.look()
    expect(h.asked).toHaveLength(1)
    expect((await h.scout.state()).cards).toHaveLength(2)
    // What changed is news again.
    h.setGithub({ prs: [pr()], reviews: [] })
    await h.scout.look()
    expect(h.asked).toHaveLength(2)
    expect((await h.scout.state()).cards[0]?.said).toContain('all 9 checks passed')
  })

  it('tries the next free models when its own does not answer, then leaves the cards in Locust’s words and says why', async () => {
    const h = await harness()
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'Rename the call log', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    await h.scout.onRunEnded({ missionId: 'look_1' })
    await h.scout.onRunEnded({ missionId: 'look_2' })
    expect((await h.scout.state()).cards[0]).toHaveProperty('reading')
    await h.scout.onRunEnded({ missionId: 'look_3' })
    // Its own model, then two free ones in its place -- and no more.
    expect(h.models).toEqual([undefined, 'opencode/longcat-2.5-preview-free', 'opencode/nemotron-3-ultra-free'])
    const state = await h.scout.state()
    expect(state.cards[0]).toMatchObject({ said: 'Someone asked you to review pull request #214, Rename the call log.' })
    expect(state.cards[0]).not.toHaveProperty('reading')
    expect(state.cards[0]).not.toHaveProperty('take')
    expect(state.modelSaid).toBe('It said nothing. These cards are in Locust’s words.')
  })

  it('on a model that is not free, never moves to another: the cards say why at once', async () => {
    const h = await harness({ nextFreeModel: async () => undefined })
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'claude', model: 'haiku' })
    await h.scout.onRunEnded({ missionId: 'look_1' })
    expect(h.models).toEqual([undefined])
    expect((await h.scout.state()).modelSaid).toBe('It said nothing. These cards are in Locust’s words.')
  })

  it('stops a look whose provider will not answer while the runtime keeps trying, and asks the next free model at once', async () => {
    const h = await harness()
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    await h.scout.providerRefused('look_1', 'The model\'s provider answered "Free usage exceeded, subscribe to Go".')
    expect(h.stopped).toEqual(['run_1'])
    expect(h.models).toEqual([undefined, 'opencode/longcat-2.5-preview-free'])
    h.answers.set('look_2', { text: 'ITEM 1\nTAKE: Worth a look today.' })
    await h.scout.onRunEnded({ missionId: 'look_2' })
    const state = await h.scout.state()
    expect(state.cards[0]).toMatchObject({ take: 'Worth a look today.' })
    expect(state.modelSaid).toBeUndefined()
    // A refusal for a look that has ended changes nothing.
    await h.scout.providerRefused('look_1', 'late')
    expect(h.stopped).toEqual(['run_1'])
  })

  it('does not wait for ever on a model that never ends its turn', async () => {
    // The look's own clock, not the test's: a save Windows holds for a moment retries on real time (replace-file.ts).
    const waits: { task: () => void; ms: number }[] = []
    const h = await harness({ answerWaitMs: 1_000, later: (task, ms) => { waits.push({ task, ms }); return waits.length } })
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    expect(waits.map((wait) => wait.ms)).toEqual([1_000])
    // Out of time: its turn is stopped, and the next free model is given the look -- up to two of them.
    waits[0]!.task()
    await vi.waitFor(() => { expect(waits).toHaveLength(2) })
    waits[1]!.task()
    await vi.waitFor(() => { expect(waits).toHaveLength(3) })
    waits[2]!.task()
    await vi.waitFor(async () => { expect((await h.scout.state()).modelSaid).toBeDefined() })
    expect(h.stopped).toEqual(['run_1', 'run_2', 'run_3'])
    const state = await h.scout.state()
    expect(state.cards[0]).not.toHaveProperty('reading')
    expect(state.modelSaid).toContain('took too long')
  })

  it('says why when its model could not be asked, and keeps the cards', async () => {
    const h = await harness({ ask: async () => ({ refused: 'OpenCode is not installed.' }) })
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    const state = await h.scout.state()
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0]).not.toHaveProperty('reading')
    expect(state.modelSaid).toBe('OpenCode is not installed.')
    expect(state.lookIds).toEqual([])
  })

  it('tells the person in Windows only about a card that needs them now, and only if they want that', async () => {
    const h = await harness()
    h.setWaiting([{ approvalId: 'ap_1', missionId: 'mis_1', teammateId: 'tm_atlas', name: 'Atlas', summary: 'Run pnpm test', requestedAt: '2026-10-12T05:30:00.000Z' }])
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    expect(h.notified).toEqual(['Atlas has waited 30 minutes for your OK.'])
    await h.scout.set({ notify: false })
    h.setWaiting([{ approvalId: 'ap_2', missionId: 'mis_2', name: 'Atlas', summary: 'x', requestedAt: '2026-10-12T05:30:00.000Z' }])
    await h.scout.onRunEnded({ missionId: 'look_1' })
    await h.scout.look()
    expect(h.notified).toHaveLength(1)
  })

  it('hears a teammate’s failed turn as it ends, and tells it at the next look -- never its own looks', async () => {
    const h = await harness()
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    await h.scout.onRunEnded({ missionId: 'failed_9' })
    await h.scout.onRunEnded({ missionId: 'mis_ok' })
    await h.scout.look()
    expect((await h.scout.state()).cards.map((card) => card.said)).toEqual(["Wren's turn failed: The model is overloaded."])
  })

  it('watches only what it is set to watch', async () => {
    const h = await harness()
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    await h.scout.set({ watches: { github: false, teammates: false } })
    h.setGithub({ prs: [pr({ checks: 'failing', notPassed: 2 })], reviews: [] })
    h.setWaiting([{ approvalId: 'ap_1', missionId: 'mis_1', name: 'Atlas', summary: 'x', requestedAt: '2026-10-12T05:00:00.000Z' }])
    await h.scout.onRunEnded({ missionId: 'failed_9' })
    await h.scout.look()
    expect((await h.scout.state()).cards).toEqual([])
  })

  it('stops when Scout is taken off the team', async () => {
    const h = await harness()
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    h.teammates.clear()
    const state = await h.scout.look()
    expect(state.settings.on).toBe(false)
  })
})

describe('what Scout keeps', () => {
  it('lasts across a restart, and a card that was waiting on a look waits on nothing after it', async () => {
    const h = await harness()
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    const again = createScout(h.deps)
    await again.start(60_000)
    const state = await again.state()
    expect(state.settings.on).toBe(true)
    expect(state.cards).toHaveLength(1)
    expect(state.cards[0]).not.toHaveProperty('reading')
    expect(JSON.parse(await readFile(h.deps.file, 'utf8')).seen).toEqual(['review:https://github.com/acme/app/pull/214'])
    again.dispose()
  })

  it('forgets a card the person dismissed, and does not bring it back', async () => {
    const h = await harness()
    h.setGithub({ prs: [], reviews: [{ number: 214, title: 'x', url: 'https://github.com/acme/app/pull/214' }] })
    await h.scout.turnOn({ runtime: 'opencode', model: 'opencode/space-bunny-free' })
    const cardId = (await h.scout.state()).cards[0]!.cardId
    await h.scout.dismiss(cardId)
    await h.scout.onRunEnded({ missionId: 'look_1' })
    await h.scout.look()
    expect((await h.scout.state()).cards).toEqual([])
  })
})
