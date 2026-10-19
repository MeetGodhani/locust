import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'

const { handlers, openPath } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), openPath: vi.fn(async () => '') }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { handlers.set(channel, fn) } }, shell: { openPath } }))

import { registerOwnCommandIpc } from './own-command-ipc.js'
import { OWN_COMMAND_EXPAND, OWN_COMMAND_LIST, OWN_COMMAND_OPEN, OWN_COMMAND_RUN } from '../shared/own-commands.js'

const host = {
  list: vi.fn(async () => []),
  expand: vi.fn(async () => ({ ok: true, text: 'Hello' })),
  allow: vi.fn(async () => ({ ok: true })),
  directory: vi.fn(async () => 'C:/profile/commands'),
  start: vi.fn(async () => ({ ok: true, id: 'a'.repeat(36), done: Promise.resolve({ id: 'a'.repeat(36), output: '', exitCode: 0, stopped: false }) })),
  stop: vi.fn(),
  stopAll: vi.fn()
}
registerOwnCommandIpc(host as never, (event) => (event as { own?: boolean }).own === true, openPath)
const sender = { isDestroyed: () => false, send: vi.fn() }

it('refuses a folder, a shell, or another window, and runs only command text', async () => {
  const run = handlers.get(OWN_COMMAND_RUN)!
  expect((await run({ own: true, sender }, { command: 'echo hello', folder: 'C:/elsewhere' }) as { ok: boolean }).ok).toBe(false)
  expect((await run({ own: true, sender }, { command: 'echo hello', file: 'cmd.exe' }) as { ok: boolean }).ok).toBe(false)
  expect((await run({ own: false, sender }, { command: 'echo hello' }) as { ok: boolean }).ok).toBe(false)
  expect(host.start).not.toHaveBeenCalled()
  expect((await run({ own: true, sender }, { command: 'echo hello', missionId: 'known' }) as { ok: boolean }).ok).toBe(true)
  expect(host.start).toHaveBeenCalledWith({ missionId: 'known' }, 'echo hello')
})

it('is not a way for a routine, a link, or another app to run a command', () => {
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
  for (const name of ['./routine-runner.ts', './locust-mcp-tools.ts', './locust-links.ts']) {
    expect(read(name)).not.toContain('own-commands:run')
    expect(read(name)).not.toContain('createOwnCommandHost')
  }
})

it('opens a commands folder the host names, never one the window names', async () => {
  const open = handlers.get(OWN_COMMAND_OPEN)!
  expect((await open({ own: true, sender }, { which: 'global', path: 'C:/Windows' }) as { ok: boolean }).ok).toBe(false)
  expect(openPath).not.toHaveBeenCalled()
  expect((await open({ own: true, sender }, { which: 'global' }) as { ok: boolean }).ok).toBe(true)
  expect(openPath).toHaveBeenCalledExactlyOnceWith('C:/profile/commands')
  expect((await handlers.get(OWN_COMMAND_LIST)!({ own: false, sender }, {}) as { ok: boolean }).ok).toBe(false)
  expect((await handlers.get(OWN_COMMAND_EXPAND)!({ own: true, sender }, { name: 'review', source: 'project', arguments: 'notes', cwd: 'C:/x' }) as { ok: boolean }).ok).toBe(false)
  expect(host.expand).not.toHaveBeenCalled()
})
