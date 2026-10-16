import { fitEventsToLedger } from '@teammate/mission-store'
import type { MissionLedger } from '@teammate/mission-store'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'
import type { CodexMissionUpdate } from '../shared/ipc.js'
import { streamedUpdates } from '../shared/streamed-updates.js'

/** The fsynced ledger is the only source for both bookkeeping and the screen. */
export async function persistEventUpdates(
  ledger: Pick<MissionLedger, 'appendEvents'>,
  runId: string,
  missionId: string,
  events: readonly NormalizedRuntimeEvent[],
  track: (events: readonly NormalizedRuntimeEvent[]) => void,
  emit: (update: CodexMissionUpdate) => void
): Promise<void> {
  // Fitted before the write so the screen shows what the ledger keeps; the
  // ledger fits again, which costs nothing on an event that already fits.
  const kept = fitEventsToLedger(events)
  await ledger.appendEvents(missionId, kept)
  track(kept)
  for (const update of streamedUpdates(runId, missionId, kept)) emit(update)
}
