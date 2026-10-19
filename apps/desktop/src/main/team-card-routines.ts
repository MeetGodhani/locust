import type { PublicRoutine, PublicTeammate } from '../shared/ipc.js'
import { roleLabelOf } from '../shared/ipc.js'
import { MAX_TEAM_CARD_ROUTINES, MAX_TEAM_CARD_TEAMMATES } from '../shared/team-card.js'
import type { TeamCardRoutine } from '../shared/team-card.js'
import { parseRoutineFile, pathsAsInputs, routineFileText, routineToFile } from './routine-file.js'
import type { RoutineFile } from './routine-file.js'

/**
 * THE TEAM'S ROUTINES ON ITS CARD (0.802; shared/team-card.ts).
 *
 * Each is written as its routine file would be, so what travels is what an
 * exported routine carries and nothing more: no ids, runs, schedule or staged
 * work. A path on this machine becomes an input to fill in on the other, as
 * Export's "make it an input" does, because a path here names nothing there.
 * The routines are the ones made in this folder (or before routines had one),
 * by the teammates on the card.
 */
export function teamCardRoutines(
  team: readonly PublicTeammate[],
  routines: readonly PublicRoutine[],
  using: { readonly workspaceId: string | undefined; readonly connectorNames: readonly string[] }
): readonly TeamCardRoutine[] {
  const carried = team.slice(0, MAX_TEAM_CARD_TEAMMATES)
  const out: TeamCardRoutine[] = []
  for (const routine of routines) {
    if (out.length >= MAX_TEAM_CARD_ROUTINES) break
    const place = carried.findIndex((mate) => mate.teammateId === routine.teammateId)
    if (place < 0) continue
    if (routine.workspaceId !== undefined && routine.workspaceId !== using.workspaceId) continue
    const asInputs = pathsAsInputs(routine.steps, routine.inputs ?? [])
    const kept = asInputs.ok ? asInputs : { steps: routine.steps, inputs: routine.inputs ?? [] }
    const file = routineToFile(routine, {
      steps: kept.steps,
      inputs: kept.inputs,
      connectorNames: using.connectorNames,
      roleOf: (id) => {
        const mate = team.find((entry) => entry.teammateId === id)
        return mate === undefined ? undefined : roleLabelOf(mate)
      }
    })
    // Written only if it reads back: a card never carries a routine another Locust would refuse.
    if (parseRoutineFile(routineFileText(file)).ok) out.push({ teammate: place, routine: file })
  }
  return out
}

/** A card's routine as a routine file, read as an imported `.locust-routine.json` is; undefined when it does not read. */
export function cardRoutineFile(entry: TeamCardRoutine): RoutineFile | undefined {
  let text: string
  try {
    text = JSON.stringify(entry.routine)
  } catch {
    return undefined
  }
  if (typeof text !== 'string') return undefined
  const read = parseRoutineFile(text)
  return read.ok ? read.file : undefined
}
