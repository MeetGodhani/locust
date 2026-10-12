import { randomBytes } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'

import type { FolderPullRequest } from '../shared/pull-request.js'
import {
  DEFAULT_SCOUT_SETTINGS,
  MAX_SCOUT_SEEN,
  branchFacts,
  cardOf,
  failedFacts,
  pullRequestFacts,
  reviewFacts,
  scoutAnswers,
  scoutPrompt,
  scoutSettingsFrom,
  waitingFacts,
  withNewCards,
  type BranchRun,
  type FailedTurn,
  type ReviewAsked,
  type ScoutCard,
  type ScoutFact,
  type ScoutSettings,
  type ScoutState,
  type WaitingCard
} from '../shared/scout.js'
import { replaceFile } from './replace-file.js'

/**
 * SCOUT, WATCHING (0.756, shared/scout.ts). One look at a time, on a timer while it is on: Locust gathers what is
 * new, makes the cards in its own words at once, and only then asks Scout's model -- one read-only turn on Scout's
 * own route -- for its take and a drafted next step, which fill the cards in when the turn ends. A look that finds
 * nothing new asks no model. A model that does not answer leaves the cards as Locust wrote them, and says so.
 */
export interface ScoutTeammate {
  readonly teammateId: string
  readonly name: string
  readonly role: string
}

export interface ScoutGithub {
  readonly prs: readonly FolderPullRequest[]
  readonly reviews: readonly ReviewAsked[]
  readonly branch?: { readonly name: string; readonly runs: readonly BranchRun[] }
}

export interface ScoutDeps {
  readonly file: string
  readonly now?: () => Date
  /** The person's pull requests, reviews asked of them and the default branch's checks; undefined when GitHub cannot be read here. */
  readonly github: () => Promise<ScoutGithub | undefined>
  /** Teammates' approval cards still waiting on the person. */
  readonly waiting: () => Promise<readonly WaitingCard[]>
  /** A run that ended, as a failed turn when it failed; undefined otherwise. */
  readonly failedTurn: (missionId: string) => Promise<FailedTurn | undefined>
  /** The team Scout may hand work to, without Scout. */
  readonly team: () => Promise<readonly ScoutTeammate[]>
  /** Starts one look on Scout's route -- or on this free model in its place: its turn, or why it did not start. */
  readonly ask: (teammateId: string, prompt: string, model?: string) => Promise<{ readonly missionId: string; readonly runId: string } | { readonly refused: string }>
  /** Stops a look's turn that will not end by itself: a provider refusing, and the runtime trying again for ever. */
  readonly stop: (runId: string) => void
  /**
   * The next free model a look may try when Scout's own free model's provider will not answer: none when Scout's
   * route is not a free one, or every one has been tried.
   */
  readonly nextFreeModel: (teammateId: string, tried: readonly string[]) => Promise<string | undefined>
  /** What a look's turn said last, once it has ended; why not, when it said nothing. */
  readonly answerOf: (missionId: string) => Promise<{ readonly text: string } | { readonly failed: string }>
  /** Makes Scout's own teammate. */
  readonly makeTeammate: (route: { readonly runtime: string; readonly model: string }) => Promise<string>
  /** Whether Scout's teammate is still on the team. */
  readonly teammateExists: (teammateId: string) => Promise<boolean>
  readonly changed: (state: ScoutState) => void
  /** A card that needs the person now, while Locust is out of sight. */
  readonly notify: (card: ScoutCard) => void
  /** How long a look's turn may take before its cards stop waiting on it. */
  readonly answerWaitMs?: number
  readonly schedule?: (task: () => void, ms: number) => unknown
  readonly clear?: (handle: unknown) => void
  /** Once, after a while: the first look after a launch, and a look's turn running out of time. */
  readonly later?: (task: () => void, ms: number) => unknown
  readonly cancel?: (handle: unknown) => void
}

interface Kept {
  readonly settings: ScoutSettings
  readonly cards: readonly ScoutCard[]
  readonly seen: readonly string[]
  readonly lookIds: readonly string[]
  /** Each pull request as the last look saw it, by its address. */
  readonly prs: readonly FolderPullRequest[]
  readonly lastLookAt?: string
  readonly modelSaid?: string
}

const EMPTY: Kept = { settings: DEFAULT_SCOUT_SETTINGS, cards: [], seen: [], lookIds: [], prs: [] }
/** A look's turn, past this, no longer keeps its cards waiting: a short read, on a model that answers in seconds. */
const ANSWER_WAIT_MS = 3 * 60_000
const MAX_LOOK_IDS = 400
/** Free models a look tries after Scout's own, each when the one before it would not answer. */
const MAX_FALLBACKS = 2

/** A look's turn under way: what it asked about, of whom, on which run, and which free models it has tried. */
interface PendingLook {
  readonly teammateId: string
  readonly prompt: string
  readonly cardIds: readonly string[]
  readonly team: readonly ScoutTeammate[]
  readonly runId: string
  readonly tried: readonly string[]
  readonly expires: unknown
}

export function createScout(deps: ScoutDeps) {
  const now = deps.now ?? (() => new Date())
  const schedule = deps.schedule ?? ((task, ms) => setInterval(task, ms))
  const clear = deps.clear ?? ((handle) => clearInterval(handle as NodeJS.Timeout))
  const later = deps.later ?? ((task, ms) => setTimeout(task, ms))
  const cancel = deps.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout))
  let kept: Kept | undefined
  let timer: unknown
  let firstLook: unknown
  let looking = false
  /** Failed turns heard as they ended, for the next look. */
  const failedSince: FailedTurn[] = []
  /** A look's turn, by its mission id. */
  const pending = new Map<string, PendingLook>()
  let writing: Promise<unknown> = Promise.resolve()

  const load = async (): Promise<Kept> => {
    if (kept !== undefined) return kept
    try {
      const parsed = JSON.parse(await readFile(deps.file, 'utf8')) as Record<string, unknown>
      kept = {
        settings: scoutSettingsFrom(parsed.settings),
        cards: Array.isArray(parsed.cards) ? (parsed.cards as ScoutCard[]).filter((card) => typeof card?.cardId === 'string' && typeof card.said === 'string').map(({ reading: _reading, ...card }) => card) : [],
        seen: Array.isArray(parsed.seen) ? parsed.seen.filter((key): key is string => typeof key === 'string').slice(-MAX_SCOUT_SEEN) : [],
        lookIds: Array.isArray(parsed.lookIds) ? parsed.lookIds.filter((id): id is string => typeof id === 'string').slice(-MAX_LOOK_IDS) : [],
        prs: Array.isArray(parsed.prs) ? (parsed.prs as FolderPullRequest[]).filter((pr) => typeof pr?.url === 'string' && typeof pr.number === 'number') : [],
        ...(typeof parsed.lastLookAt === 'string' ? { lastLookAt: parsed.lastLookAt } : {})
      }
    } catch {
      kept = EMPTY
    }
    return kept
  }
  const stateOf = (from: Kept): ScoutState => ({
    settings: from.settings,
    cards: from.cards,
    lookIds: from.lookIds,
    ...(from.lastLookAt === undefined ? {} : { lastLookAt: from.lastLookAt }),
    ...(from.modelSaid === undefined ? {} : { modelSaid: from.modelSaid })
  })
  /** Kept in memory at once, written whole beside the file and moved over it, one write at a time. */
  const keep = async (next: Kept): Promise<ScoutState> => {
    kept = next
    const body = `${JSON.stringify({ settings: next.settings, cards: next.cards, seen: next.seen, lookIds: next.lookIds, prs: next.prs, ...(next.lastLookAt === undefined ? {} : { lastLookAt: next.lastLookAt }) })}\n`
    const write = writing.then(async () => {
      const temporary = `${deps.file}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' })
        await replaceFile(temporary, deps.file)
      } catch {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
    })
    writing = write.catch(() => undefined)
    await write
    const state = stateOf(next)
    deps.changed(state)
    return state
  }
  /*
   * EVERY CHANGE IS ONE STEP ON THE NEWEST STATE. A change read what Scout held, awaited, then wrote: a card dismissed
   * while a look was writing its own came back. Now each change is worked out from what is held at the moment it is
   * kept, with nothing awaited between the reading and the keeping.
   */
  const mutate = async (change: (from: Kept) => Kept): Promise<ScoutState> => {
    const loaded = await load()
    return keep(change(kept ?? loaded))
  }

  const restart = (settings: ScoutSettings): void => {
    if (timer !== undefined) clear(timer)
    timer = undefined
    if (settings.on && settings.teammateId !== undefined) timer = schedule(() => { void look() }, settings.everyMinutes * 60_000)
  }

  /** Locust's own look: what is new since the last one, as facts. */
  const gather = async (from: Kept, lookStamp: string): Promise<{ facts: readonly ScoutFact[]; prs: readonly FolderPullRequest[] }> => {
    const facts: ScoutFact[] = []
    let prs = from.prs
    if (from.settings.watches.github) {
      const github = await deps.github().catch(() => undefined)
      if (github !== undefined) {
        facts.push(...pullRequestFacts(new Map(from.prs.map((pr) => [pr.url, pr] as const)), github.prs, lookStamp))
        facts.push(...reviewFacts(github.reviews))
        if (github.branch !== undefined) facts.push(...branchFacts(github.branch.name, github.branch.runs))
        prs = github.prs
      }
    }
    if (from.settings.watches.teammates) {
      facts.push(...waitingFacts(await deps.waiting().catch(() => []), now()))
      facts.push(...failedFacts(failedSince.splice(0)))
    } else {
      failedSince.splice(0)
    }
    const seen = new Set(from.seen)
    return { facts: facts.filter((fact, index) => !seen.has(fact.key) && facts.findIndex((other) => other.key === fact.key) === index), prs }
  }

  const look = async (): Promise<ScoutState> => {
    const from = await load()
    if (looking || !from.settings.on || from.settings.teammateId === undefined) return stateOf(from)
    looking = true
    try {
      const teammateId = from.settings.teammateId
      // Scout taken off the team is Scout turned off: nothing looks for a teammate who is gone.
      if (!(await deps.teammateExists(teammateId).catch(() => true))) {
        const state = await mutate((latest) => ({ ...latest, settings: { ...latest.settings, on: false } }))
        restart(state.settings)
        return state
      }
      const at = now()
      const stamp = at.toISOString()
      const { facts, prs } = await gather(from, stamp)
      if (facts.length === 0) return await mutate((latest) => ({ ...latest, prs, lastLookAt: stamp }))
      const team = (await deps.team().catch(() => [])).filter((mate) => mate.teammateId !== teammateId)
      const cards = facts.map((fact) => cardOf(fact, `card_${randomBytes(6).toString('hex')}`, at, true))
      let state = await mutate((latest) => ({
        ...latest,
        cards: withNewCards(latest.cards, cards),
        seen: [...latest.seen, ...facts.map((fact) => fact.key)].slice(-MAX_SCOUT_SEEN),
        prs,
        lastLookAt: stamp
      }))
      if (state.settings.notify) for (const card of cards) if (card.urgency === 'now') deps.notify(card)
      // Then Scout's model, for its take and the next step.
      const prompt = scoutPrompt({ facts, team: team.map((mate) => ({ name: mate.name, role: mate.role })) })
      state = await askFor({ teammateId, prompt, cardIds: cards.map((card) => card.cardId), team, tried: [] }) ?? state
      return state
    } finally {
      looking = false
    }
  }

  /**
   * One turn for a look, on Scout's model or on the free one given in its place. A turn that does not start settles
   * its cards with why; one that starts is waited on, and stops waiting -- and is stopped -- if it runs out of time.
   */
  const askFor = async (look: Omit<PendingLook, 'runId' | 'expires'>, model?: string): Promise<ScoutState | undefined> => {
    const asked = await deps.ask(look.teammateId, look.prompt, model)
      .catch((error: unknown) => ({ refused: error instanceof Error ? error.message : 'The look could not start.' }))
    if ('refused' in asked) return settle(look.cardIds, undefined, asked.refused)
    const expires = later(() => { void gaveUp(asked.missionId, 'Scout’s model took too long to answer.') }, deps.answerWaitMs ?? ANSWER_WAIT_MS)
    pending.set(asked.missionId, { ...look, runId: asked.runId, expires })
    return mutate((latest) => ({ ...latest, lookIds: [...latest.lookIds, asked.missionId].slice(-MAX_LOOK_IDS) }))
  }

  /*
   * A LOOK WHOSE MODEL WILL NOT ANSWER (2026-10-12, the packaged 0.756 drive): Space Bunny's provider answered "Free
   * usage exceeded", OpenCode tried again on its own for as long as it ran, and the cards said "Scout is reading it"
   * until the look's time ran out -- its turn still running, so every later look found Scout busy. Now the turn is
   * stopped, and the look tries the next free model, as the design said it would; past MAX_FALLBACKS, or on a route
   * that is not a free one, the cards stay in Locust's words and say why.
   */
  const gaveUp = async (missionId: string, why: string): Promise<void> => {
    const look = pending.get(missionId)
    if (look === undefined) return
    pending.delete(missionId)
    cancel(look.expires)
    try { deps.stop(look.runId) } catch { /* it has ended already */ }
    const next = look.tried.length >= MAX_FALLBACKS ? undefined : await deps.nextFreeModel(look.teammateId, look.tried).catch(() => undefined)
    if (next === undefined) {
      await settle(look.cardIds, undefined, `${why} These cards are in Locust’s words.`)
      return
    }
    const { runId: _runId, expires: _expires, ...rest } = look
    await askFor({ ...rest, tried: [...look.tried, next] }, next)
  }

  /** The cards a look asked about, no longer waiting: with what the model added, or why it added nothing. */
  const settle = (cardIds: readonly string[], answers: ReadonlyMap<number, { readonly take?: string; readonly draft?: ScoutCard['draft'] }> | undefined, why?: string): Promise<ScoutState> =>
    mutate((from) => {
      const cards = from.cards.map((card) => {
        const at = cardIds.indexOf(card.cardId)
        if (at < 0) return card
        const { reading: _reading, ...rest } = card
        const answer = answers?.get(at + 1)
        return { ...rest, ...(answer?.take === undefined ? {} : { take: answer.take }), ...(answer?.draft === undefined ? {} : { draft: answer.draft }) }
      })
      // An answer that came clears the last one's excuse; one that did not says why.
      const { modelSaid: _was, ...base } = from
      return { ...base, cards, ...(why === undefined ? {} : { modelSaid: why }) }
    })

  const ended = async (missionId: string): Promise<void> => {
    const look = pending.get(missionId)
    if (look === undefined) return
    const answer = await deps.answerOf(missionId).catch(() => ({ failed: 'Scout’s model’s answer could not be read.' }))
    // A turn that ended without an answer is a model that would not answer: the next free one is tried.
    if ('failed' in answer) {
      await gaveUp(missionId, answer.failed)
      return
    }
    pending.delete(missionId)
    cancel(look.expires)
    await settle(look.cardIds, scoutAnswers(answer.text, look.cardIds.length, look.team))
  }

  return {
    state: async (): Promise<ScoutState> => stateOf(await load()),
    /** Picks up where the last launch left off: on, it looks again shortly and on its timer after. */
    async start(firstLookMs = 30_000): Promise<void> {
      const from = await load()
      // A look's cards from before a restart wait on nothing now.
      if (from.cards.some((card) => card.reading === true)) await mutate((latest) => ({ ...latest, cards: latest.cards.map(({ reading: _reading, ...card }) => card) }))
      restart(from.settings)
      if (from.settings.on) firstLook = later(() => { firstLook = undefined; void look() }, firstLookMs)
    },
    /** On again with its own teammate; a new Scout, on this route, when it has none. */
    async turnOn(route: { readonly runtime: string; readonly model: string } | undefined): Promise<ScoutState | { readonly refused: string }> {
      const from = await load()
      let teammateId = from.settings.teammateId
      if (teammateId === undefined || !(await deps.teammateExists(teammateId).catch(() => false))) {
        if (route === undefined) return { refused: 'Scout needs a model to read with: install OpenCode for a free one, then turn it on.' }
        try {
          teammateId = await deps.makeTeammate(route)
        } catch (error) {
          return { refused: error instanceof Error ? error.message : 'Scout could not be added to the team.' }
        }
      }
      const madeId = teammateId
      const state = await mutate((latest) => ({ ...latest, settings: { ...latest.settings, on: true, teammateId: madeId } }))
      restart(state.settings)
      return look()
    },
    async set(change: unknown): Promise<ScoutState> {
      let before: ScoutSettings | undefined
      const state = await mutate((latest) => {
        before = latest.settings
        // The window may not name Scout's teammate: Scout made it, and keeps it.
        return { ...latest, settings: scoutSettingsFrom({ ...(typeof change === 'object' && change !== null ? change : {}), teammateId: latest.settings.teammateId }, latest.settings) }
      })
      if (state.settings.everyMinutes !== before?.everyMinutes || state.settings.on !== before.on) restart(state.settings)
      return state
    },
    dismiss: (cardId: unknown): Promise<ScoutState> => mutate((latest) => ({ ...latest, cards: latest.cards.filter((card) => card.cardId !== cardId) })),
    look,
    /** A look's turn whose provider will not answer while the runtime keeps trying: stopped, and the next model tried. */
    async providerRefused(missionId: string, why: string): Promise<void> {
      if (pending.has(missionId)) await gaveUp(missionId, why)
    },
    /** Every run that ends: a look's turn fills its cards in; a teammate's failed turn is news for the next look. */
    async onRunEnded(mission: { readonly missionId: string }): Promise<void> {
      if (pending.has(mission.missionId)) {
        await ended(mission.missionId)
        return
      }
      const from = await load()
      if (!from.settings.on || !from.settings.watches.teammates || from.lookIds.includes(mission.missionId)) return
      const failed = await deps.failedTurn(mission.missionId).catch(() => undefined)
      if (failed !== undefined && failed.teammateId !== from.settings.teammateId) failedSince.push(failed)
    },
    dispose(): void {
      if (timer !== undefined) clear(timer)
      timer = undefined
      if (firstLook !== undefined) cancel(firstLook)
      firstLook = undefined
      for (const look of pending.values()) {
        cancel(look.expires)
        try { deps.stop(look.runId) } catch { /* ended already */ }
      }
      pending.clear()
    }
  }
}

export type Scout = ReturnType<typeof createScout>
