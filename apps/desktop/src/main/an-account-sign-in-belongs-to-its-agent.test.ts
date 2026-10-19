import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAccountLogin } from './agent-account-login.js'
import type { ExecutableLaunch } from '@teammate/runtime-adapters'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
const launch: ExecutableLaunch = { commandName: 'codex', discoveredPath: '/tools/agent', executablePath: '/tools/agent', prefixArgs: ['agent.js'], kind: 'node-shim', env: { CODEX_HOME: '/throwaway/work', ELECTRON_RUN_AS_NODE: '1' } }

describe('the agent owns its account sign-in', () => {
  it('runs each documented login command hidden with its home and discards all process output', () => {
    for (const runtime of ['claude', 'codex'] as const) {
      const child = new EventEmitter()
      vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>)
      const done = vi.fn()
      startAccountLogin(runtime, launch, '/throwaway/work', done)
      expect(spawn).toHaveBeenLastCalledWith('/tools/agent', ['agent.js', ...(runtime === 'claude' ? ['auth', 'login'] : ['login'])], expect.objectContaining({ cwd: '/throwaway/work', stdio: 'ignore', windowsHide: true, env: expect.objectContaining(launch.env) }))
      expect(child.listenerCount('data')).toBe(0)
      child.emit('exit', 0)
      child.emit('error', new Error('not forwarded'))
      expect(done).toHaveBeenCalledExactlyOnceWith(true)
    }
  })

  it('reports failure once without returning the process error or any token', () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>)
    const done = vi.fn()
    startAccountLogin('codex', launch, '/throwaway/work', done)
    child.emit('error', new Error('secret test token must never leave the agent'))
    child.emit('exit', 1)
    expect(done).toHaveBeenCalledExactlyOnceWith(false)
  })
})
