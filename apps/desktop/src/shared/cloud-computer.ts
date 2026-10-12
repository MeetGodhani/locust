/**
 * YOUR CLOUD COMPUTER (0.761), the part both sides read: where a task's copy lives there, what a turn on it is
 * called on screen, and how its paths read as this folder's (main/cloud-computer.ts says how it works).
 */

/** Every task's own copy of the repository sits under here on the codespace, beside the repository itself. */
export const CLOUD_TASK_ROOT = '/workspaces/.locust'

/** A task id Locust made: `t_` and letters and digits, nothing a path could be steered by. */
export const CLOUD_TASK_ID = /^t_[a-z0-9]{6,32}$/

export function cloudTaskDir(taskId: string): string {
  if (!CLOUD_TASK_ID.test(taskId)) throw new Error('That is not a task Locust made.')
  return `${CLOUD_TASK_ROOT}/${taskId}`
}

/** A path inside a task's copy there, as this folder's own: `/workspaces/.locust/t_ab12cd/src/a.ts` reads `src/a.ts`. */
export function cloudRelative(path: string): string | undefined {
  const match = /^\/workspaces\/\.locust\/t_[a-z0-9]{6,32}(?:\/(.*))?$/.exec(path.replace(/\\/g, '/'))
  if (match === null) return undefined
  return match[1] === undefined || match[1].length === 0 ? '.' : match[1]
}

/** One file of a change there: its lines added and taken out. */
export interface CloudChangeFile {
  readonly path: string
  readonly added: number
  readonly removed: number
  readonly binary?: true
}

/** The machine, in the words the screen uses. */
export const CLOUD_MACHINE_WORDS = '2 CPUs, 8 GB'

/** A pull request on GitHub, as a card names and opens it. */
export interface CloudPullRequest {
  readonly number: number
  readonly url: string
}

/**
 * A conversation's turn on the cloud computer, as the thread shows it: where it ran, and what became of its change.
 * `there` is a change waiting on the cloud computer; `home`, one applied to this folder; `pr`, one sent to a pull
 * request on GitHub (0.762); `carried`, one a later turn's change now includes; `none`, a turn that changed nothing.
 */
export interface PublicCloudTurn {
  readonly missionId: string
  readonly codespace: string
  readonly repo: string
  readonly branch?: string
  readonly taskId: string
  readonly state: 'working' | 'there' | 'home' | 'pr' | 'none' | 'carried' | 'discarded' | 'failed'
  readonly files?: readonly CloudChangeFile[]
  readonly appliedAt?: string
  readonly problem?: string
  /** The pull request this turn's change went to (`pr`). */
  readonly pullRequest?: CloudPullRequest
  /** The conversation's pull request, while a change is waiting (`there`): it can be added to it. */
  readonly openPullRequest?: CloudPullRequest
  /** A `carried` turn's change, once the later change that holds it went somewhere: here, to a pull request, or back. */
  readonly outcome?: 'home' | 'pr' | 'discarded'
}

/**
 * Whether a turn's files are in this folder now (0.762): a turn that ran here, a change that came home, or one carried
 * into a change that did. Otherwise the files it names are on the cloud computer (or on GitHub, or put back), and a
 * button that opens, copies or shows this folder's file of that name shows something else.
 */
export function cloudFilesHere(turn: PublicCloudTurn | undefined): boolean {
  return turn === undefined || turn.state === 'home' || turn.state === 'none' || (turn.state === 'carried' && turn.outcome === 'home')
}

/** A cloud computer as Settings lists it. */
export interface PublicCloudComputer {
  readonly name: string
  readonly repo: string
  readonly state: 'available' | 'starting' | 'stopped' | 'other'
  readonly lastUsedAt?: string
}

/** Where a folder stands with the cloud computer: the window asks first when it has none. */
export type CloudFolderState =
  | { readonly ok: true; readonly repo: string; readonly branch?: string; readonly computer?: PublicCloudComputer }
  | { readonly ok: false; readonly message: string; readonly permission?: true; readonly notOnGitHub?: true }

/** A step of setting one up, as the dialog shows them. */
export type CloudSetupStep = 'making' | 'readying' | 'installing' | 'ready'

/** GitHub's word for a codespace's state, as Locust's three. */
export function cloudStateOf(state: string): PublicCloudComputer['state'] {
  const word = state.toLowerCase()
  if (word === 'available') return 'available'
  if (word === 'shutdown' || word === 'shuttingdown' || word === 'archived') return 'stopped'
  if (word === 'starting' || word === 'provisioning' || word === 'queued' || word === 'created' || word === 'rebuilding') return 'starting'
  return 'other'
}

/** "2 files · +18 −6" */
export function cloudChangeWords(files: readonly CloudChangeFile[]): string {
  const added = files.reduce((sum, file) => sum + file.added, 0)
  const removed = files.reduce((sum, file) => sum + file.removed, 0)
  return `${String(files.length)} ${files.length === 1 ? 'file' : 'files'} · +${String(added)} −${String(removed)}`
}
