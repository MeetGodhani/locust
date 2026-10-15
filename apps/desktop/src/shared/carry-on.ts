import type { MissionRuntimeId } from '@teammate/runtime-adapters'

import type { MissionMode } from './ipc.js'
import { isMissionRuntime, runtimeDisplayName } from './runtimes.js'

/**
 * WHEN A PLAN RUNS OUT (0.774).
 *
 * A run that hit its account's usage limit stopped where it was and waited, and Settings said the third way on was
 * "Not built. Locust will not move your work to an AI agent you did not choose." The model picker had promised a
 * "Fallback chain" in Settings since the first design, and there never was one. Every piece was there already: Locust
 * knows when a plan ran out (the agent says so, `route.limit_detected` / `quota-exhausted`), and a reply on another
 * agent carries the conversation over with a summary of what was done (codex-mission.ts, the route switch).
 *
 * So the stopped run's card offers it -- "Carry on with Claude Code", one press -- and a person who wants no press at
 * all picks the agent in Settings and turns on Without asking. Only ever the agent the person picked, or pressed:
 * nothing moves to an agent nobody chose.
 */
export const CARRY_ON_CHANNEL = 'mission:carry-on'

/** Who carries the work on when an agent's plan runs out, and whether Locust waits for a press first. */
export interface PlanRunsOut {
  readonly runtime: MissionRuntimeId
  /** That agent's model. Absent, the agent's own default. */
  readonly model?: string
  /** Carry on without a press. Off, the stopped run's card offers it. */
  readonly automatic: boolean
}

/** The agent and model a carried-on turn runs on. */
export interface CarryOnRoute {
  readonly runtime: MissionRuntimeId
  readonly model?: string
}

export type CarryOnResponse =
  | { readonly ok: true; readonly missionId: string }
  | { readonly ok: false; readonly message: string }

/**
 * Whether a run's own events say its plan ran out before it finished: the agent's limit (`quota-exhausted`), with no
 * completion after it. A warning that the window is nearly used up is a `temporary-rate-limit`, not this.
 */
export function planRanOut(events: readonly { readonly type: string; readonly payload?: unknown }[]): boolean {
  let limited = false
  for (const event of events) {
    const kind = typeof event.payload === 'object' && event.payload !== null ? (event.payload as { readonly kind?: unknown }).kind : undefined
    if ((event.type === 'route.limit_detected' || event.type === 'run.failed') && kind === 'quota-exhausted') limited = true
    else if (event.type === 'run.completed') limited = false
  }
  return limited
}

/** Only a known agent that can run a turn; anything else is no choice at all. */
export function parsedPlanRunsOut(value: unknown): PlanRunsOut | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { runtime, model, automatic } = value as Record<string, unknown>
  const route = parsedCarryOnRoute({ runtime, model })
  return route === undefined ? undefined : { ...route, automatic: automatic === true }
}

export function parsedCarryOnRoute(value: unknown): CarryOnRoute | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { runtime, model } = value as Record<string, unknown>
  // Gemini is planned: no turn can run on it.
  if (!isMissionRuntime(runtime) || runtime === 'gemini') return undefined
  const named = typeof model === 'string' && model.length > 0 && model.length <= 200 && model !== 'account-default' ? model : undefined
  return { runtime, ...(named === undefined ? {} : { model: named }) }
}

/**
 * The agents Locust suggests, best first, when the person has picked none: the plans people pay for before the free
 * models. Only for the card's one press -- carrying on without a press needs the person's own pick.
 */
export const CARRY_ON_ORDER: readonly MissionRuntimeId[] = ['claude', 'codex', 'cursor', 'copilot', 'antigravity', 'muse', 'opencode']

/** The agent the stopped run's card offers: the person's pick when it can run, else the first in `CARRY_ON_ORDER` that can. */
export function carryOnOffer(
  from: MissionRuntimeId,
  chosen: PlanRunsOut | undefined,
  ready: ReadonlySet<MissionRuntimeId>
): CarryOnRoute | undefined {
  if (chosen !== undefined && chosen.runtime !== from && ready.has(chosen.runtime)) {
    return { runtime: chosen.runtime, ...(chosen.model === undefined ? {} : { model: chosen.model }) }
  }
  const runtime = CARRY_ON_ORDER.find((candidate) => candidate !== from && ready.has(candidate))
  return runtime === undefined ? undefined : { runtime }
}

/**
 * Approve each action needs an agent that stops and asks. Carried to one that cannot, the turn would run without the
 * asking the person chose, so it is not carried there at all.
 */
const ASKS_BEFORE_EACH_ACTION: ReadonlySet<MissionRuntimeId> = new Set(['codex', 'opencode', 'copilot'])

export function carryOnRefusal(mode: MissionMode, to: MissionRuntimeId): string | undefined {
  if (mode !== 'approve-each' || ASKS_BEFORE_EACH_ACTION.has(to)) return undefined
  return `${runtimeDisplayName(to)} cannot ask before each action, so this turn was not carried on there.`
}

/** The carried-on turn's instruction, under the summary of what was done. Locust's words, never shown as the person's. */
export function carryOnPrompt(from: MissionRuntimeId): string {
  // What was done is in the summary above this line; "check it" sent a free model to read files and run git on a
  // one-line task the person had asked to be done with no tool (the 0.774 drive).
  return `${runtimeDisplayName(from)} ran out of its plan's usage before it finished. Carry on with the task from where it stopped: what it already did is above, so finish what is left, the way the task asks.`
}
