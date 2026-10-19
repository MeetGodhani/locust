import { spawn } from 'node:child_process'
import { releaseProcessTree, spawnShape, type ExecutableLaunch } from '@teammate/runtime-adapters'
import type { AccountAgent } from '../shared/agent-accounts.js'

/** Login owns its browser flow. Never retain or forward its stdout/stderr (which may contain a token). */
export function startAccountLogin(runtime: AccountAgent, launch: ExecutableLaunch, home: string, done: (ok: boolean) => void): () => Promise<void> {
  const args = [...launch.prefixArgs, ...(runtime === 'claude' ? ['auth', 'login'] : ['login'])]
  const shape = spawnShape(launch.executablePath, args)
  const child = spawn(launch.executablePath, [...shape.args], {
    cwd: home, env: { ...process.env, ...launch.env }, stdio: 'ignore', windowsHide: true,
    ...(shape.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {}),
    ...(process.platform === 'win32' ? {} : { detached: true })
  })
  let ended = false
  const finish = (ok: boolean) => { if (ended) return; ended = true; clearTimeout(timer); done(ok) }
  const cancel = async () => {
    if (ended) return
    finish(false)
    if (child.pid !== undefined) { if (!await releaseProcessTree(child.pid)) child.kill() }
    else child.kill()
  }
  const timer = setTimeout(() => { void cancel() }, 10 * 60_000)
  timer.unref()
  child.once('error', () => finish(false))
  child.once('exit', code => finish(code === 0))
  return cancel
}
