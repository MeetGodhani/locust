import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { policyTerminalRefusal } from '../shared/organization-policy.js'
import { createOwnCommandHost, type CommandProcess } from './own-command-host.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function profile() { const root = await mkdtemp(join(tmpdir(), 'locust-own-cmd-')); roots.push(root); return root }

function scripted(output: string, code: number | null = 0): CommandProcess {
  let close: (value?: unknown) => void = () => {}
  let out: (chunk: string) => void = () => {}
  const proc: CommandProcess = {
    pid: 7,
    stdin: { write() {}, end() {} },
    stdout: { on(_event, listener) { out = listener as (chunk: string) => void } },
    stderr: { on() {} },
    on(event, listener) { if (event === 'close') close = listener },
    kill() { close(null) }
  }
  queueMicrotask(() => { out(output); close(code) })
  return proc
}

const shell = { id: 'powershell', name: 'Windows PowerShell', file: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', args: ['-NoLogo'] }

it('runs in the conversation folder, in the terminal panel\'s default shell, not a path the window sent', async () => {
  const seen: { file?: string; cwd?: string; input?: string } = {}
  const host = createOwnCommandHost({
    root: await profile(),
    folder: async (context) => context.missionId === 'known' ? 'C:/work/shop' : undefined,
    refusal: () => undefined,
    shells: () => [shell, { id: 'cmd', name: 'Command Prompt', file: 'C:/Windows/System32/cmd.exe', args: [] }],
    spawn: (file, _args, opts) => { seen.file = file; seen.cwd = opts.cwd; seen.input = opts.input; return scripted('hello\n', 0) }
  })
  const started = await host.start({ missionId: 'known' }, 'echo hello')
  expect(started.ok).toBe(true)
  if (!started.ok) return
  const result = await started.done
  expect(seen).toEqual({ file: shell.file, cwd: 'C:/work/shop', input: 'echo hello' })
  expect(result.output).toBe('hello\n')
  expect(result.exitCode).toBe(0)
  expect(result.stopped).toBe(false)
})

it('does not run when the organization turns the terminal off', async () => {
  const spawn = vi.fn()
  const host = createOwnCommandHost({
    root: await profile(),
    folder: async () => 'C:/work/shop',
    refusal: () => policyTerminalRefusal({ path: 'C:/policy.json', present: true, policy: { terminal: false } }),
    shells: () => [shell],
    spawn
  })
  const started = await host.start({}, 'echo hello')
  expect(started.ok).toBe(false)
  if (started.ok) return
  expect(started.message).toContain('terminal')
  expect(spawn).not.toHaveBeenCalled()
})

it('stops a command that is still running', async () => {
  let close: (value?: unknown) => void = () => {}
  let killed = false
  const host = createOwnCommandHost({
    root: await profile(),
    folder: async () => 'C:/work/shop',
    refusal: () => undefined,
    shells: () => [shell],
    spawn: () => ({
      pid: 9,
      stdin: { write() {}, end() {} },
      stdout: { on() {} },
      stderr: { on() {} },
      on(event: string, listener: (value?: unknown) => void) { if (event === 'close') close = listener },
      kill() { killed = true; close(null) }
    })
  })
  const started = await host.start({}, 'ping -t localhost')
  expect(started.ok).toBe(true)
  if (!started.ok) return
  host.stop(started.id)
  const result = await started.done
  expect(killed).toBe(true)
  expect(result.stopped).toBe(true)
  expect(result.exitCode).toBeNull()
})

it('stops everything the command started, and the shell itself only when that fails', async () => {
  // `!npm run dev` kept its server after Stop when only the shell was killed (0.797).
  for (const released of [true, false]) {
    let close: (value?: unknown) => void = () => {}
    let killed = false
    const ended: number[] = []
    const host = createOwnCommandHost({
      root: await profile(),
      folder: async () => 'C:/work/shop',
      refusal: () => undefined,
      shells: () => [shell],
      release: async (pid) => { ended.push(pid); if (released) close(null); return released },
      spawn: () => ({
        pid: 11,
        stdin: { write() {}, end() {} },
        stdout: { on() {} },
        stderr: { on() {} },
        on(event: string, listener: (value?: unknown) => void) { if (event === 'close') close = listener },
        kill() { killed = true; close(null) }
      })
    })
    const started = await host.start({}, 'npm run dev')
    expect(started.ok).toBe(true)
    if (!started.ok) return
    host.stop(started.id)
    const result = await started.done
    expect(ended).toEqual([11])
    expect(killed).toBe(!released)
    expect(result.stopped).toBe(true)
  }
})

it('lists a nested command and runs a global bang at once', async () => {
  const root = await profile()
  await mkdir(join(root, 'commands', 'team'), { recursive: true })
  await writeFile(join(root, 'commands', 'team', 'review.md'), '---\ndescription: Looks at the diff\n---\nReview\n\n!`echo hello`\n', 'utf8')
  const spawned: string[] = []
  const host = createOwnCommandHost({
    root,
    folder: async () => 'C:/work/shop',
    refusal: () => undefined,
    shells: () => [shell],
    spawn: (_file, _args, opts) => { spawned.push(opts.input ?? ''); return scripted('hello\n', 0) }
  })
  const listed = await host.list({})
  expect(listed.map((command) => command.name)).toEqual(['team/review'])
  expect(listed[0]?.source).toBe('global')
  const expanded = await host.expand({}, 'team/review', 'global', '')
  expect(expanded.ok).toBe(true)
  if (!expanded.ok || 'ask' in expanded) return
  expect(spawned).toEqual(['echo hello'])
  expect(expanded.text).toContain('hello')
  expect(expanded.text).not.toContain('!`echo hello`')
})

it('waits for a yes before a project command runs a bang, then remembers the folder', async () => {
  const root = await profile()
  const folder = await mkdtemp(join(tmpdir(), 'locust-own-proj-'))
  roots.push(folder)
  await mkdir(join(folder, '.locust', 'commands'), { recursive: true })
  await writeFile(join(folder, '.locust', 'commands', 'status.md'), '---\ndescription: This folder\nmode: plan\nteammate: Wren\n---\nStatus $1\n\n!`echo $1`\n', 'utf8')
  const spawned: string[] = []
  const host = createOwnCommandHost({
    root,
    folder: async () => folder,
    refusal: () => undefined,
    shells: () => [shell],
    spawn: (_file, _args, opts) => { spawned.push(opts.input ?? ''); return scripted('notes\n', 0) }
  })
  const asked = await host.expand({}, 'status', 'project', 'notes')
  expect(asked).toEqual({ ok: true, ask: ['echo notes'] })
  expect(spawned).toEqual([])
  expect(await host.allow({})).toEqual({ ok: true })
  const expanded = await host.expand({}, 'status', 'project', 'notes')
  expect(spawned).toEqual(['echo notes'])
  expect(expanded.ok).toBe(true)
  if (!expanded.ok || 'ask' in expanded) return
  expect(expanded.text).toContain('notes')
  expect(expanded.mode).toBe('plan')
  expect(expanded.teammate).toBe('Wren')
})
