import type { MissionLedger } from '@teammate/mission-store'

/** Every method that changes what the ledger holds. Reads are left as they are. */
const WRITES = [
  'createMission',
  'appendEvents',
  'appendHostFailure',
  'createCheckpoint',
  'appendPeerLinks',
  'appendEditCheck',
  'appendApproval',
  'deleteMission',
  'restoreMission',
  'emptyTrash',
  'pruneMissions'
] as const satisfies readonly (keyof MissionLedger)[]

/**
 * The ledger, counting its writes, so a reader that derives something from
 * all of it can tell "nothing changed" without reading it again.
 *
 * The phone page asks for its conversation list every 3 s while it is open,
 * and building that list read the whole history: 13 ms at 50 missions, 131 ms
 * at 2,000, about 4% of the main thread for an answer that rarely changes
 * (review 2026-10-15, P4). Keyed on this count it is read once per change.
 *
 * The count moves when a write is ASKED for, before it lands, so a reader
 * that saw the old count and reads again after the write sees the new data.
 */
export function countingLedgerWrites(ledger: MissionLedger): { readonly ledger: MissionLedger; readonly writes: () => number } {
  let count = 0
  const counted: MissionLedger = { ...ledger }
  for (const name of WRITES) {
    const write = ledger[name] as (...args: never[]) => unknown
    ;(counted as unknown as Record<string, unknown>)[name] = (...args: never[]) => {
      count += 1
      const result = write(...args)
      // Counted again once it has landed, so a read that began mid-write is not kept as current.
      if (result instanceof Promise) void result.then(() => { count += 1 }, () => { count += 1 })
      else count += 1
      return result
    }
  }
  return { ledger: counted, writes: () => count }
}

/**
 * One value, rebuilt only when its key changes; callers at the same key share
 * the build in flight.
 */
export function keyedOnce<T>(build: () => Promise<T>): (key: string) => Promise<T> {
  let held: { readonly key: string; readonly value: Promise<T> } | undefined
  return (key) => {
    if (held?.key === key) return held.value
    const value = build()
    held = { key, value }
    // A failed build is not kept: the next ask tries again.
    value.catch(() => {
      if (held?.value === value) held = undefined
    })
    return value
  }
}
