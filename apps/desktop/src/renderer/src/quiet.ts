/**
 * How long a run can say nothing before the app says so.
 *
 * From Astra's numbers rather than a guess: the solo write baseline is a 70s
 * process whose first record lands well inside twenty seconds, and the
 * eight-way case put 45s between a process starting and its notification. So
 * twenty is past normal and short of the observed bad case.
 *
 * It lives here, in a module neither surface owns, because both surfaces need
 * it and neither may own the number. The room has said this since 2026-09-11;
 * the conversation did not, and Colin hit exactly the case it exists for on
 * 2026-09-13 -- a Cursor run that showed "working ···" and nothing else for
 * over two minutes. MEASURED in that mission's own ledger
 * (`mission_3848a498`): `run.started` at 3.5s, and then not one runtime event
 * until 128.7s, at which point thirty arrived inside three seconds. The app
 * was drawing the truth; it just had no way to say "and nothing has come back
 * yet", which is the difference between a run that is thinking and a run that
 * is hung.
 */
export const QUIET_SECONDS_BEFORE_SAYING_SO = 20

/** Whether a run that has not spoken has now been quiet long enough to say. */
export function hasBeenQuiet(startedAt: string, now: number): boolean {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return false
  return (now - started) / 1000 >= QUIET_SECONDS_BEFORE_SAYING_SO
}

/*
 * AND A RUN THAT HAS SPOKEN, THEN GONE QUIET (0.758): five minutes.
 *
 * The 0.755 sweep's drive-queue-after-a-turn: the free model answered "ONE", opened Notepad on the file it had
 * written, and the turn waited on it -- the line said "Working… 6m 8s", then the same for forty minutes, nothing to
 * tell it from a turn at work, until the drive gave up. A line naming a command that runs is left alone: it already
 * says what the turn waits on, and a test suite may run for ten minutes.
 */
export const QUIET_MINUTES_BEFORE_SAYING_SO = 5

/** Whole minutes since the turn was last heard from, once that is long enough to say; otherwise undefined. */
export function quietMinutes(lastHeardAt: string | undefined, now: number): number | undefined {
  const heard = lastHeardAt === undefined ? Number.NaN : Date.parse(lastHeardAt)
  if (!Number.isFinite(heard)) return undefined
  const minutes = Math.floor((now - heard) / 60_000)
  return minutes >= QUIET_MINUTES_BEFORE_SAYING_SO ? minutes : undefined
}
