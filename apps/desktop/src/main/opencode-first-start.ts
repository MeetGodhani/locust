import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { CommandResult, ExecutableLaunch, ProbeCommand } from '@teammate/runtime-adapters'

/*
 * OPENCODE SETS ITSELF UP BEFORE THE FIRST MESSAGE, NOT DURING IT (0.780).
 *
 * A run that may edit names Locust's command guard as an OpenCode plugin (0.722), and the first time OpenCode is told
 * about any plugin it installs its own plugin package into its config folder: 61 MB of node_modules, over the
 * network. On a clean machine that was the first message's whole wait -- "OpenCode took 89.3 s to say it had started",
 * then an answer in 7 s (clean-machine drive, packaged 0.779, 2026-10-16). Every start after it took 2 s.
 *
 * `opencode debug config` with a plugin named does that install and nothing else: no model is asked, no session is
 * made (MEASURED 2026-10-16, OpenCode 1.19.2 in an empty home: 48 s, then 2 s; with no plugin named it installs
 * nothing). So once OpenCode is found ready and its config folder has no plugin package, Locust runs that once, in the
 * background, naming the same guard a run names -- while the person is still reading the screen Install left them on.
 */

/** OpenCode's config folder: XDG's config home (OpenCode uses xdg-basedir on every platform), then `opencode`. */
export function openCodeConfigFolder(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(home, '.config')
  return join(base, 'opencode')
}

/** Whether OpenCode has already installed its plugin package there, which is what its first start waits for. */
export function openCodeIsSetUp(folder: string, exists: (path: string) => boolean = existsSync): boolean {
  return exists(join(folder, 'node_modules', '@opencode-ai', 'plugin'))
}

/** Long enough for 61 MB on a slow line; the command ends by itself once the install is done. */
export const OPENCODE_SETUP_TIMEOUT_MS = 5 * 60_000

export type OpenCodeSetUpOutcome = 'set-up' | 'already' | 'failed' | 'not-found' | 'tried'

export interface OpenCodeFirstStart {
  /** Set OpenCode up if it is not, at most once per launch; a second call while it runs shares the first. */
  readonly ensure: () => Promise<OpenCodeSetUpOutcome>
  /** True while a start of OpenCode would have to set it up first: what the start line says. */
  readonly willSetUp: () => boolean
}

export function createOpenCodeFirstStart(options: {
  readonly locate: () => Promise<ExecutableLaunch | undefined>
  /** The command guard's plugin URL, as a run names it; undefined when it could not be written. */
  readonly plugin: () => Promise<string | undefined>
  /** Runs a command with no shell; its `env` is merged over the host's. */
  readonly run: (command: ProbeCommand) => Promise<CommandResult>
  readonly folder?: () => string
  readonly exists?: (path: string) => boolean
  readonly note?: (line: string) => void
  readonly now?: () => number
}): OpenCodeFirstStart {
  const folder = options.folder ?? (() => openCodeConfigFolder())
  const exists = options.exists ?? existsSync
  const now = options.now ?? Date.now
  let running: Promise<OpenCodeSetUpOutcome> | undefined
  // One try a launch: a machine with no network should not run a five-minute install at every discovery.
  let tried = false
  const setUp = async (): Promise<OpenCodeSetUpOutcome> => {
    const launch = await options.locate().catch(() => undefined)
    if (launch === undefined) return 'not-found'
    // Any plugin makes OpenCode install its package; the guard is the one a run names, so it is the same install.
    const plugin = await options.plugin().catch(() => undefined)
    if (plugin === undefined) return 'failed'
    const started = now()
    const result = await options
      .run({
        purpose: 'readiness',
        executablePath: launch.executablePath,
        args: [...launch.prefixArgs, 'debug', 'config'],
        timeoutMs: OPENCODE_SETUP_TIMEOUT_MS,
        env: { ...(launch.env ?? {}), OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [plugin] }) }
      })
      .catch(() => undefined)
    const seconds = Math.round((now() - started) / 1000)
    const done = openCodeIsSetUp(folder(), exists)
    options.note?.(done ? `OpenCode set itself up for its first start in ${String(seconds)} s` : `OpenCode did not finish setting itself up (${result?.timedOut === true ? 'timed out' : `exit ${String(result?.exitCode ?? 'none')}`}); its first run will do it`)
    return done ? 'set-up' : 'failed'
  }
  return {
    ensure: () => {
      if (openCodeIsSetUp(folder(), exists)) return Promise.resolve('already')
      if (running !== undefined) return running
      if (tried) return Promise.resolve('tried')
      tried = true
      running = setUp().finally(() => {
        running = undefined
      })
      return running
    },
    willSetUp: () => !openCodeIsSetUp(folder(), exists)
  }
}
