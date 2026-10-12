import { pullRequestNews, type FolderPullRequest } from './pull-request.js'

/*
 * SCOUT, A TEAMMATE THAT KEEPS WATCH (0.756). Colin, 2026-10-12, on the four ideas taken from the Grok Bot video:
 * "maybe allow the user to change the model of proactive teammate if they wish but in the meantime let's just use the
 * best free model like muse or space bunny". The design he was shown: https://claude.ai/artifact/2BMzn1KUaZNnNvJzBHgEfG.
 *
 * Locust looks first, with no model and nothing sent: the person's pull requests and their checks, the reviews asked
 * of them, the default branch's checks, a teammate waiting on them, a turn that failed. Only what is NEW goes to
 * Scout's model, in one read-only turn with no tools, and it adds its take and drafts the next step for the teammate
 * who could take it. Every card leads with Locust's own sentence, so a weak model can add to a card but never put a
 * claim in it that is not true; when the model does not answer, the cards come anyway, in Locust's words. Nothing on
 * a card happens until the person presses it.
 */

export const SCOUT_STATE = 'scout:state'
export const SCOUT_TURN_ON = 'scout:turn-on'
export const SCOUT_SET = 'scout:set'
export const SCOUT_DISMISS = 'scout:dismiss'
export const SCOUT_LOOK = 'scout:look'
/** Main to the window: what Scout holds changed. */
export const SCOUT_CHANGED = 'scout:changed'

export const SCOUT_EVERY_MINUTES = [10, 30, 60] as const
export type ScoutEvery = (typeof SCOUT_EVERY_MINUTES)[number]

/** What Scout watches; each can be switched off. */
export interface ScoutWatches {
  /** The person's pull requests and their checks, reviews asked of them, the default branch's checks. */
  readonly github: boolean
  /** A teammate waiting on them; a turn that failed. */
  readonly teammates: boolean
}

export interface ScoutSettings {
  readonly on: boolean
  /** Scout's own teammate: its name, face and model. */
  readonly teammateId?: string
  readonly everyMinutes: ScoutEvery
  readonly watches: ScoutWatches
  /** A Windows notification for a card that needs the person now, when Locust is out of sight. */
  readonly notify: boolean
}

export const DEFAULT_SCOUT_SETTINGS: ScoutSettings = { on: false, everyMinutes: 10, watches: { github: true, teammates: true }, notify: true }

/** How soon the person needs it: now raises the card and, out of sight, notifies; the rest wait for Home. */
export type ScoutUrgency = 'now' | 'soon' | 'later'
export type ScoutTone = 'red' | 'amber' | 'green' | 'blue' | 'quiet'

export type ScoutOpen =
  | { readonly kind: 'url'; readonly url: string; readonly label: string }
  | { readonly kind: 'conversation'; readonly missionId: string; readonly label: string }

/** Something Locust found, in its own words. */
export interface ScoutFact {
  /** What it is about, in the state it was found in: the same news is never told twice. */
  readonly key: string
  readonly urgency: ScoutUrgency
  /** Locust's sentence: the card's first line, whatever the model says. */
  readonly said: string
  /** More for the model to read: a title, a command, a failed turn's last line. Never shown as the card's claim. */
  readonly detail?: string
  readonly chips?: readonly { readonly text: string; readonly tone: ScoutTone }[]
  readonly open?: ScoutOpen
  /** The teammate it is about, when it is about one. */
  readonly teammateId?: string
}

export interface ScoutDraft {
  readonly teammateId: string
  readonly name: string
  readonly message: string
}

export interface ScoutCard extends ScoutFact {
  readonly cardId: string
  /** When it was found. */
  readonly at: string
  /** Scout's model is still reading it. */
  readonly reading?: true
  /** What Scout's model adds: why it matters, or what it would do. Shown as Scout's, under Locust's sentence. */
  readonly take?: string
  /** The next step, written for a teammate: one press sends it. */
  readonly draft?: ScoutDraft
}

export interface ScoutState {
  readonly settings: ScoutSettings
  /** Newest first. */
  readonly cards: readonly ScoutCard[]
  /** Its looks' turns: never listed as conversations. */
  readonly lookIds: readonly string[]
  readonly lastLookAt?: string
  /** Why its model did not answer the last time, when it did not: the cards came in Locust's words. */
  readonly modelSaid?: string
}

export interface ScoutApi {
  state(): Promise<ScoutState>
  /** Makes Scout, on this route, and starts it; on again with its teammate when it has one. */
  turnOn(route: { readonly runtime: string; readonly model: string } | undefined): Promise<ScoutState | { readonly refused: string }>
  set(change: Partial<Pick<ScoutSettings, 'on' | 'everyMinutes' | 'watches' | 'notify'>>): Promise<ScoutState>
  dismiss(cardId: string): Promise<ScoutState>
  look(): Promise<ScoutState>
  onChanged(listener: (state: ScoutState) => void): () => void
}

/** The most cards kept; the oldest go first. */
export const MAX_SCOUT_CARDS = 30
/** Fact keys remembered as told, so a fact is never told twice; the oldest go first. */
export const MAX_SCOUT_SEEN = 500
/** A teammate waiting this long on the person is worth a card. */
export const SCOUT_WAITING_MS = 10 * 60_000
const MAX_SAID = 300
const MAX_TAKE = 400
const MAX_DRAFT = 2_000

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/*
 * THE PULL REQUESTS' NEWS. A pull request seen for the first time is news only for what needs work now -- a failing
 * check, changes asked for, a conflict -- and its key is its state, so a lost record never tells it twice. After
 * that, whatever changed that a person would want to hear (pullRequestNews, the same words the folder's own watch
 * uses), keyed by the look that found it: the same state can come back, and coming back is news.
 */
export function pullRequestFacts(before: ReadonlyMap<string, FolderPullRequest>, now: readonly FolderPullRequest[], look: string): readonly ScoutFact[] {
  const facts: ScoutFact[] = []
  for (const pr of now) {
    // By its address, not its number: another folder's repository has a #12 too.
    const was = before.get(pr.url)
    const title = clip(pr.title, 120)
    const open: ScoutOpen = { kind: 'url', url: pr.url, label: 'Open the pull request' }
    if (was === undefined) {
      const needs: string[] = []
      if (pr.checks === 'failing') needs.push(`${String(pr.notPassed)} of ${String(pr.checkCount)} checks did not pass`)
      if (pr.review === 'changes-requested') needs.push('changes were asked for')
      if (pr.conflicts === true) needs.push('it conflicts with its base branch')
      if (needs.length === 0) continue
      const sentence = needs.join(', and ')
      facts.push({
        key: `pr:${pr.url}:${pr.checks}:${pr.review ?? ''}:${pr.conflicts === true ? 'c' : ''}`,
        urgency: pr.checks === 'failing' ? 'now' : 'soon',
        said: `Your pull request #${String(pr.number)}, ${title}: ${sentence}.`,
        chips: [{ text: `#${String(pr.number)}`, tone: 'quiet' }, ...(pr.checks === 'failing' ? [{ text: `${String(pr.notPassed)} of ${String(pr.checkCount)} checks not passed`, tone: 'red' as const }] : [])],
        open
      })
      continue
    }
    const news = pullRequestNews(was, pr)
    if (news === undefined) continue
    facts.push({
      key: `pr:${pr.url}:${look}`,
      urgency: news.needsWork ? (pr.checks === 'failing' ? 'now' : 'soon') : 'later',
      said: `Your pull request #${String(pr.number)}, ${title}: ${news.said.charAt(0).toLowerCase()}${news.said.slice(1)}.`,
      chips: [{ text: `#${String(pr.number)}`, tone: 'quiet' }, { text: news.said, tone: news.needsWork ? 'red' : 'green' }],
      open
    })
  }
  return facts
}

/** A review asked of the person, from `gh pr list --search review-requested:@me --json number,title,url,author`. */
export interface ReviewAsked {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly author?: string
}

export function reviewsAskedOf(json: string): readonly ReviewAsked[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((one): ReviewAsked[] => {
    if (typeof one !== 'object' || one === null) return []
    const pr = one as Record<string, unknown>
    if (typeof pr.number !== 'number' || !Number.isInteger(pr.number) || pr.number <= 0) return []
    if (typeof pr.url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr.url)) return []
    const author = typeof pr.author === 'object' && pr.author !== null && typeof (pr.author as Record<string, unknown>).login === 'string'
      ? clip(String((pr.author as Record<string, unknown>).login), 60) : undefined
    return [{ number: pr.number, title: typeof pr.title === 'string' ? clip(pr.title, 120) : '', url: pr.url, ...(author === undefined ? {} : { author }) }]
  })
}

export function reviewFacts(asked: readonly ReviewAsked[]): readonly ScoutFact[] {
  return asked.map((pr) => ({
    // By its address: another repository's #214 is another review.
    key: `review:${pr.url}`,
    urgency: 'soon',
    said: `${pr.author ?? 'Someone'} asked you to review pull request #${String(pr.number)}, ${pr.title}.`,
    chips: [{ text: `#${String(pr.number)}`, tone: 'quiet' }, { text: 'review asked', tone: 'amber' }],
    open: { kind: 'url', url: pr.url, label: 'Open the pull request' }
  }))
}

/** One run of the default branch's checks, from `gh run list --json databaseId,conclusion,status,workflowName,url`. */
export interface BranchRun {
  readonly id: number
  readonly workflow: string
  readonly url: string
  readonly failed: boolean
}

export function branchRunsOf(json: string): readonly BranchRun[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const latest = new Map<string, BranchRun>()
  for (const one of parsed) {
    if (typeof one !== 'object' || one === null) continue
    const run = one as Record<string, unknown>
    // Only a run that has finished says how the branch stands; gh lists the newest first.
    if (run.status !== 'completed' || typeof run.databaseId !== 'number' || typeof run.url !== 'string' || !/^https:\/\/github\.com\//.test(run.url)) continue
    const workflow = typeof run.workflowName === 'string' ? clip(run.workflowName, 80) : 'checks'
    if (latest.has(workflow)) continue
    latest.set(workflow, { id: run.databaseId, workflow, url: run.url, failed: run.conclusion === 'failure' || run.conclusion === 'timed_out' || run.conclusion === 'startup_failure' })
  }
  return [...latest.values()]
}

export function branchFacts(branch: string, runs: readonly BranchRun[]): readonly ScoutFact[] {
  return runs.filter((run) => run.failed).map((run) => ({
    key: `branch:${String(run.id)}`,
    urgency: 'soon',
    said: `${run.workflow} failed on ${clip(branch, 60)}.`,
    chips: [{ text: clip(branch, 60), tone: 'quiet' }, { text: `${run.workflow} · failed`, tone: 'red' }],
    open: { kind: 'url', url: run.url, label: 'Open the run' }
  }))
}

/** A teammate's approval card, waiting on the person. */
export interface WaitingCard {
  readonly approvalId: string
  readonly missionId: string
  readonly teammateId?: string
  readonly name?: string
  readonly summary: string
  readonly requestedAt: string
}

export function waitingFacts(cards: readonly WaitingCard[], now: Date, waitMs = SCOUT_WAITING_MS): readonly ScoutFact[] {
  return cards.flatMap((card): ScoutFact[] => {
    const since = Date.parse(card.requestedAt)
    if (!Number.isFinite(since) || now.getTime() - since < waitMs) return []
    const minutes = Math.round((now.getTime() - since) / 60_000)
    return [{
      key: `waiting:${card.approvalId}`,
      urgency: 'now',
      said: `${card.name ?? 'A teammate'} has waited ${String(minutes)} minutes for your OK.`,
      detail: clip(card.summary, 300),
      chips: [{ text: 'waiting on you', tone: 'amber' }],
      open: { kind: 'conversation', missionId: card.missionId, label: 'Open it' },
      ...(card.teammateId === undefined ? {} : { teammateId: card.teammateId })
    }]
  })
}

/** A turn that failed, as the record keeps it. */
export interface FailedTurn {
  readonly missionId: string
  readonly teammateId?: string
  readonly name?: string
  readonly asked: string
  /** What the run said last, or the failure's own words. */
  readonly why?: string
}

/*
 * Why it failed, in the runtime's own words, leads: it is what the person needs, and without it Scout's model guessed
 * -- the first drive's Scout blamed the shell for a model that did not exist, and drafted Wren the wrong fix.
 */
export function failedFacts(turns: readonly FailedTurn[]): readonly ScoutFact[] {
  return turns.map((turn) => ({
    key: `failed:${turn.missionId}`,
    urgency: 'soon',
    said: `${turn.name ?? 'A teammate'}'s turn failed${turn.why === undefined ? '.' : `: ${clip(turn.why, 160)}`}`,
    detail: `It was asked: ${clip(turn.asked, 300)}`,
    chips: [{ text: 'failed', tone: 'red' }],
    open: { kind: 'conversation', missionId: turn.missionId, label: 'Open it' },
    ...(turn.teammateId === undefined ? {} : { teammateId: turn.teammateId })
  }))
}

/** What the look asks Scout's model: the new facts, the team, and the one form an answer takes. */
export function scoutPrompt(input: { readonly facts: readonly ScoutFact[]; readonly team: readonly { readonly name: string; readonly role: string }[] }): string {
  return [
    'You are Scout, a teammate who keeps watch for the person you work with. Locust found what is below. Use only what is below: do not use any tools, open files, run commands or change anything. Read, and write.',
    'What is new:',
    input.facts.map((fact, index) => `${String(index + 1)}. ${fact.said}${fact.detail === undefined ? '' : `\n   ${fact.detail}`}`).join('\n'),
    input.team.length === 0 ? 'The team: nobody else yet.' : `The team:\n${input.team.map((mate) => `- ${mate.name}, ${mate.role}`).join('\n')}`,
    [
      'For each numbered item you have something to add to, write a block in exactly this form, and nothing else:',
      '',
      'ITEM <its number>',
      'TAKE: one or two sentences for the person: why it matters, or what you would do. No greeting.',
      'HAND TO: the teammate from the team above who should take the next step, by name, or none',
      'DRAFT: the message you would send them: what to do, and how they will know it is done',
      '',
      'Skip an item you have nothing to add to. Say nothing that is not in what is above.'
    ].join('\n')
  ].join('\n\n')
}

export interface ScoutAnswer {
  readonly take?: string
  readonly draft?: ScoutDraft
}

/**
 * Scout's model's answer, item by item. Loose about the form a small model gives it -- bold labels, a colon after the
 * number, extra blank lines -- and strict about what it may say: an item that is not in the look, a teammate who is
 * not on the team, or a draft with nobody to send it to is left out.
 */
export function scoutAnswers(text: string, factCount: number, team: readonly { readonly teammateId: string; readonly name: string }[]): ReadonlyMap<number, ScoutAnswer> {
  const answers = new Map<number, ScoutAnswer>()
  const plain = text.replace(/\r\n?/g, '\n').replace(/\*\*/g, '')
  const blocks = plain.split(/^[ \t#>-]*ITEM[ \t]+(\d+)[ \t]*:?[ \t]*$/im)
  for (let index = 1; index + 1 < blocks.length; index += 2) {
    const item = Number(blocks[index])
    if (!Number.isInteger(item) || item < 1 || item > factCount || answers.has(item)) continue
    const body = blocks[index + 1] ?? ''
    const field = (name: string): string | undefined => {
      const found = new RegExp(`^[ \\t-]*${name}[ \\t]*:[ \\t]*(.*)$`, 'im').exec(body)
      return found?.[1]?.trim()
    }
    const takeWords = field('TAKE')
    const handTo = field('HAND TO')
    // A draft runs to the end of its block.
    const draftAt = /^[ \t-]*DRAFT[ \t]*:[ \t]*/im.exec(body)
    const draftWords = draftAt === null ? undefined : body.slice(draftAt.index + draftAt[0].length).trim()
    const mate = handTo === undefined || /^none\b/i.test(handTo) ? undefined : team.find((one) => one.name.toLowerCase() === handTo.replace(/[.,;:!]+$/, '').trim().toLowerCase())
    const take = takeWords === undefined || takeWords.length === 0 ? undefined : clip(takeWords, MAX_TAKE)
    const message = draftWords === undefined || draftWords.length === 0 ? undefined : draftWords.slice(0, MAX_DRAFT).trim()
    if (take === undefined && (mate === undefined || message === undefined)) continue
    answers.set(item, {
      ...(take === undefined ? {} : { take }),
      ...(mate === undefined || message === undefined ? {} : { draft: { teammateId: mate.teammateId, name: mate.name, message } })
    })
  }
  return answers
}

/** A fact as a card, before Scout's model has read it. */
export function cardOf(fact: ScoutFact, cardId: string, at: Date, reading: boolean): ScoutCard {
  return { ...fact, said: clip(fact.said, MAX_SAID), cardId, at: at.toISOString(), ...(reading ? { reading: true as const } : {}) }
}

/** The new cards first, the oldest past MAX_SCOUT_CARDS gone. */
export function withNewCards(cards: readonly ScoutCard[], added: readonly ScoutCard[]): readonly ScoutCard[] {
  return [...added, ...cards].slice(0, MAX_SCOUT_CARDS)
}

/** Settings as a window may send them; anything else is the default, or what was there. */
export function scoutSettingsFrom(value: unknown, base: ScoutSettings = DEFAULT_SCOUT_SETTINGS): ScoutSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return base
  const input = value as Record<string, unknown>
  const watches = typeof input.watches === 'object' && input.watches !== null ? input.watches as Record<string, unknown> : {}
  return {
    on: typeof input.on === 'boolean' ? input.on : base.on,
    ...(typeof input.teammateId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.teammateId) ? { teammateId: input.teammateId } : base.teammateId === undefined ? {} : { teammateId: base.teammateId }),
    everyMinutes: (SCOUT_EVERY_MINUTES as readonly number[]).includes(input.everyMinutes as number) ? input.everyMinutes as ScoutEvery : base.everyMinutes,
    watches: {
      github: typeof watches.github === 'boolean' ? watches.github : base.watches.github,
      teammates: typeof watches.teammates === 'boolean' ? watches.teammates : base.watches.teammates
    },
    notify: typeof input.notify === 'boolean' ? input.notify : base.notify
  }
}
