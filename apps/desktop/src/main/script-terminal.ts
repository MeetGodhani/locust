import { spawn } from 'node:child_process'

import { openInLinuxTerminal } from './linux-terminal.js'
import { openInMacTerminal } from './mac-terminal.js'

/**
 * macOS and Linux open a terminal by handing it a script Locust writes
 * (mac-terminal.ts, linux-terminal.ts); Windows starts its console directly.
 */
export function opensAScriptTerminal(platform: NodeJS.Platform): platform is 'darwin' | 'linux' {
  return platform === 'darwin' || platform === 'linux'
}

export async function openInScriptTerminal(
  platform: 'darwin' | 'linux',
  cwd: string,
  program: { readonly file: string; readonly args: readonly string[] },
  env: Readonly<Record<string, string>> | undefined,
  /** Test seam; each opener starts its own process otherwise. */
  run?: typeof spawn
): Promise<{ readonly ok: true; readonly where: string } | { readonly ok: false; readonly message: string }> {
  if (platform === 'darwin') return run === undefined ? openInMacTerminal(cwd, program, env) : openInMacTerminal(cwd, program, env, run)
  return run === undefined ? openInLinuxTerminal(cwd, program, env) : openInLinuxTerminal(cwd, program, env, run)
}
