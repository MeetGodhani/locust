/**
 * OpenCode's free models that answered the drive sweeps, steadiest first
 * (0.712): the 2026-10-05 scorecard (three tasks each, in Edit), the sweeps'
 * own turn list since (_tools/sweep-drives.mjs FREE_MODELS), and one word asked
 * of each on 2026-10-09. Kept with that list at each release's sweep. Muse
 * Spark is last: rate-limited for whole days (2026-10-06). Not named: Ling 3.0
 * (failing since 2026-10-05), and any model newer than the last sweep.
 *
 * Shared since 0.756: the window picks a new person's free model from it, and
 * Scout falls back along it when its free model's provider will not answer.
 */
export const FREE_MODELS_BEST_FIRST: readonly string[] = [
  'opencode/space-bunny-free',
  'opencode/longcat-2.5-preview-free',
  'opencode/nemotron-3-ultra-free',
  'opencode/nemotron-3.5-lightning-free',
  'opencode/mimo-v2.6-flash-free',
  'opencode/ling-3.1-flash-free',
  'opencode/muse-spark-1.3-contributor-free'
]
