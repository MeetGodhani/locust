import { mkdtemp, readFile, rm, writeFile, symlink, rename } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExecutableLaunch, RuntimeCommandSpec, RuntimeDiscovery, RuntimeProcessRun } from '@teammate/runtime-adapters'
import type { MissionLedger } from '@teammate/mission-store'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentAccounts } from './agent-accounts.js'
import { createCodexMissionService } from './codex-mission.js'
import { createCompareStore } from './compare-store.js'
import { createBackgroundRuns } from './claude-background-runs.js'
import { terminalRequestFor } from './open-in-terminal.js'
import { BACKED_UP_FOLDERS, LEFT_OUT } from './profile-backup.js'
import { parseOrganizationPolicy } from './organization-policy.js'
import { policyFeatureRefusal, policyTurnRefusal } from '../shared/organization-policy.js'
import { routeAtStart, startAs } from '../shared/route-at-start.js'
import { accountFromRoute, accountUsageKey } from '../shared/agent-accounts.js'
import { usageWindowsFrom, limitedRuntimesFrom } from './mission-history.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile), copyFile: vi.fn(actual.copyFile) }
})

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(extra: Partial<Parameters<typeof createAgentAccounts>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'locust-account-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const login = vi.fn(async () => () => undefined)
  const store = createAgentAccounts({ directory, login, ...extra })
  return { directory, login, store }
}
const launch: ExecutableLaunch = { commandName: 'codex', discoveredPath: '/tools/codex', executablePath: '/tools/codex', prefixArgs: [], kind: 'native', env: { ELECTRON_RUN_AS_NODE: '1' } }

describe('an added account has only its own home', () => {
  it('preserves the exact launch and environment when no account is selected', async () => {
    const { store } = await fixture()
    const a = await store.add('codex', 'Work')
    expect(await store.launch('codex', undefined, launch)).toBe(launch)
    await store.launch('codex', a.id, launch)
    expect(await store.launch('codex', undefined, launch)).toBe(launch)
    expect(launch.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('gives each supported agent and account a separate home under Locust data', async () => {
    const { store, directory } = await fixture()
    const a = await store.add('claude', 'Work')
    const b = await store.add('claude', 'Personal')
    const c = await store.add('codex', 'Work')
    const first = await store.launch('claude', a.id, launch)
    const second = await store.launch('claude', b.id, launch)
    const third = await store.launch('codex', c.id, launch)
    expect(first.env?.CLAUDE_CONFIG_DIR).toBe(join(directory, 'agent-accounts', a.id))
    expect(second.env?.CLAUDE_CONFIG_DIR).not.toBe(first.env?.CLAUDE_CONFIG_DIR)
    expect(third.env?.CODEX_HOME).toBe(join(directory, 'agent-accounts', c.id))
    expect(first.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    await expect(store.launch('codex', a.id, launch)).rejects.toThrow('another agent')
    await expect(store.add('cursor', 'Work')).rejects.toThrow('does not support')
    await expect(store.launch('codex', '../outside', launch)).rejects.toThrow('Choose an account')
  })

  it('never reads, copies or prints a credential file while managing accounts', async () => {
    const { store, directory } = await fixture()
    const read = vi.mocked(fs.readFile).mockClear()
    const copy = vi.mocked(fs.copyFile).mockClear()
    const log = vi.spyOn(console, 'log')
    const a = await store.add('codex', 'Work')
    await store.rename(a.id, 'Office')
    await store.launch('codex', a.id, launch)
    await store.login(a.id)
    await store.cancel(a.id)
    await store.remove(a.id)
    expect(read.mock.calls.length).toBeGreaterThan(0)
    expect(read.mock.calls.every(([file]) => String(file) === join(directory, 'agent-accounts', 'accounts.json'))).toBe(true)
    expect(copy).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('removes only the home Locust created and refuses a junction pointing elsewhere', async () => {
    const { store, directory } = await fixture()
    const a = await store.add('codex', 'Work')
    const b = await store.add('claude', 'Personal')
    const outside = join(directory, 'unrelated.txt')
    await writeFile(outside, 'keep')
    await store.remove(a.id)
    expect(await readFile(outside, 'utf8')).toBe('keep')
    expect((await store.list()).map(x => x.id)).toEqual([b.id])
    await expect(store.launch('codex', a.id, launch)).rejects.toThrow('removed')
    const home = join(directory, 'agent-accounts', b.id)
    const moved = join(directory, 'elsewhere')
    await rename(home, moved)
    await symlink(moved, home, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(store.remove(b.id)).rejects.toThrow('moved')
    expect((await store.list()).map(x => x.id)).toEqual([b.id])
  })

  it('tracks waiting, success, cancellation and interrupted sign-ins without output', async () => {
    let finish: (ok: boolean) => void = () => undefined
    const cancel = vi.fn()
    const { store, directory } = await fixture({ login: async (_runtime, _home, _env, done) => { finish = done; return cancel } })
    const a = await store.add('claude', 'Work')
    await store.login(a.id)
    expect((await store.list())[0]?.state).toBe('waiting')
    finish(true)
    expect((await store.list())[0]?.state).toBe('ready')
    await store.login(a.id)
    await store.cancel(a.id)
    finish(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect((await store.list())[0]?.state).toBe('failed')
    await store.login(a.id)
    const restarted = createAgentAccounts({ directory, login: async () => () => undefined })
    expect((await restarted.list())[0]?.state).toBe('failed')
    store.dispose()
  })

  it('enforces the accounts policy before adding, signing in or launching and still allows removal', async () => {
    const state = { path: '/policy.json', present: true, policy: parseOrganizationPolicy({ accounts: false }) }
    expect(state.policy.accounts).toBe(false)
    expect(() => parseOrganizationPolicy({ accounts: 'false' })).toThrow('invalid')
    let blocked = false
    const { store, login } = await fixture({ refusal: () => blocked ? policyFeatureRefusal(state, 'accounts') : undefined })
    const a = await store.add('codex', 'Work')
    blocked = true
    await expect(store.add('codex', 'Another')).rejects.toThrow('organization')
    await expect(store.login(a.id)).rejects.toThrow('organization')
    await expect(store.launch('codex', a.id, launch)).rejects.toThrow('organization')
    expect(login).not.toHaveBeenCalled()
    expect(policyTurnRefusal(state, { runtime: 'codex', account: a.id, mode: 'ask' })).toContain('accounts')
    expect(policyTurnRefusal(state, { runtime: 'codex', mode: 'ask' })).toBeUndefined()
    await store.remove(a.id)
    expect(await store.list()).toEqual([])
  })

  it('keeps the saved account for CLI/editor starts and an explicit default for a picker override', async () => {
    const { store } = await fixture()
    const a = await store.add('claude', 'Work')
    const teammate = { teammateId: 'mate', route: { runtime: 'claude' as const, model: 'sonnet', account: a.id, mode: 'ask' as const } }
    expect(routeAtStart({}, teammate)).toEqual({ runtime: 'claude', model: 'sonnet', account: a.id })
    expect(routeAtStart({ runtime: 'claude', model: 'sonnet', routeOverrideFor: 'mate' }, teammate)).toEqual({ runtime: 'claude', model: 'sonnet' })
    expect(startAs(teammate, { route: { runtime: 'codex', model: 'account-default' }, mode: 'ask', effort: undefined }, new Map()).route.account).toBe(a.id)
  })

  it('compares the same agent and model on two distinct accounts and keeps both across reload', async () => {
    const { store, directory } = await fixture()
    const a = await store.add('codex', 'Work')
    const b = await store.add('codex', 'Personal')
    const compares = createCompareStore({ rootDirectory: directory })
    const comparison = await compares.create({ prompt: 'Read this', routes: [a, b].map(account => ({ runtime: 'codex', model: 'account-default', account: account.id })) })
    const restored = await createCompareStore({ rootDirectory: directory }).get(comparison.compareId)
    expect(restored?.slots.map(s => s.route.account)).toEqual([a.id, b.id])
    const launches = await Promise.all(restored!.slots.map(s => store.launch(s.route.runtime, s.route.account, launch)))
    expect(new Set(launches.map(l => l.env?.CODEX_HOME)).size).toBe(2)
    await expect(compares.addColumn(comparison.compareId, { runtime: 'codex', model: 'account-default', account: a.id })).rejects.toThrow('already')
  })

  it('dispatches a real mission service command with its account home and leaves a default command unchanged', async () => {
    const { store, directory } = await fixture()
    const a = await store.add('codex', 'Work')
    const commands: RuntimeCommandSpec[] = []
    const ledger = { createMission: vi.fn(async () => undefined), appendEvents: vi.fn(async () => undefined), appendHostFailure: vi.fn(async () => undefined), flush: async () => undefined } as unknown as MissionLedger
    const service = createCodexMissionService({ workspacePath: directory, ledger, schedule: task => queueMicrotask(task),
      discover: async (runtime, account) => [{ id: 'codex', kind: 'agent-runtime', displayName: 'Codex CLI', optional: false, availability: 'available', readiness: 'ready', executable: await store.launch(runtime!, account, launch), supportedFeatures: [], requiredFeatures: [], diagnostics: [] } as RuntimeDiscovery],
      runner: { start: command => { commands.push(command); return { records: { async *[Symbol.asyncIterator]() {}, drainAvailable: () => [] }, completion: Promise.resolve({ exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 0, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: '', finishedAt: '' }) } satisfies RuntimeProcessRun } }
    })
    const one = await service.start('Read this folder', 'codex', 'ask', { account: a.id }, () => undefined, undefined, undefined, undefined, undefined, undefined, undefined, { key: 'a' })
    const two = await service.start('Read this folder', 'codex', 'ask', {}, () => undefined, undefined, undefined, undefined, undefined, undefined, undefined, { key: 'b' })
    expect(one.ok).toBe(true)
    expect(two.ok).toBe(true)
    expect(commands[0]?.env?.CODEX_HOME).toBe(join(directory, 'agent-accounts', a.id))
    expect(commands[1]?.env?.CODEX_HOME).toBeUndefined()
    expect(commands[1]?.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(one.ok && accountFromRoute(one.data.resolvedRouteId)).toBe(a.id)
    expect(two.ok && two.data.resolvedRouteId.endsWith('-account:default')).toBe(true)
    await service.dispose()
  })

  it('keeps usage and exhausted limits separate for each account', async () => {
    const { store } = await fixture()
    const a = await store.add('codex', 'Work')
    const b = await store.add('codex', 'Personal')
    const missions = [a, b].map((account, i) => ({ metadata: { resolvedRouteId: `codex-account:${account.id}` }, events: [
      { sourceAdapter: 'codex', occurredAt: `2026-10-19T10:00:0${i}Z`, type: 'adapter.diagnostic', payload: { code: 'codex.usage_window', message: `${i * 100}% used` } },
      { sourceAdapter: 'codex', occurredAt: `2026-10-19T10:00:0${i}Z`, type: i === 0 ? 'route.limit_detected' : 'run.completed', payload: { kind: 'quota-exhausted', message: 'Plan used up' } }
    ] })) as unknown as Parameters<typeof usageWindowsFrom>[0]
    expect(Object.keys(usageWindowsFrom(missions))).toEqual([accountUsageKey('codex', a.id), accountUsageKey('codex', b.id)])
    expect(limitedRuntimesFrom(missions)).toEqual({ [accountUsageKey('codex', a.id)]: 'Plan used up' })
  })

  it('keeps account homes out of backups and refuses removal while that account is in use', async () => {
    let busy: string | undefined
    const { store } = await fixture({ inUse: (_runtime, account) => account === busy })
    const a = await store.add('codex', 'Work')
    const b = await store.add('codex', 'Personal')
    busy = a.id
    await expect(store.remove(a.id)).rejects.toThrow('busy')
    await store.remove(b.id)
    expect((await store.list()).map(a => a.id)).toEqual([a.id])
    expect(LEFT_OUT['agent-accounts']).toContain('never copied')
    expect(BACKED_UP_FOLDERS).not.toContain('agent-accounts')
  })

  it('starts, watches and stops background work on the same account', async () => {
    const { directory, store } = await fixture()
    const a = await store.add('claude', 'Work')
    const claude = vi.fn(async (_args: readonly string[], _cwd: string, _account?: string) => ({ code: 0, stdout: 'backgrounded · abcdef12', stderr: '' }))
    let list: () => Promise<unknown> = async () => undefined
    const background = createBackgroundRuns({ file: join(directory, 'background.json'), claude, sessionOf: async () => undefined, bringIn: async () => ({ refused: 'unused' }), onChange: () => undefined,
      watch: (_seen, read) => { list = read; return { watch: () => undefined, stop: () => undefined } } })
    const run = await background.start({ prompt: 'Read this', folder: directory, sandbox: 'read-only', account: a.id })
    expect(run).toMatchObject({ ok: true, run: { account: a.id } })
    expect(claude.mock.calls[0]?.[2]).toBe(a.id)
    claude.mockResolvedValue({ code: 0, stdout: '[]', stderr: '' })
    await list()
    expect(claude).toHaveBeenLastCalledWith(['agents', '--json', '--all'], directory, a.id)
    await background.stop('abcdef12')
    expect(claude).toHaveBeenLastCalledWith(['stop', 'abcdef12'], directory, a.id)
    background.dispose()
  })

  it('opens an existing conversation in a terminal with the recorded account home', async () => {
    const { directory, store } = await fixture()
    const a = await store.add('codex', 'Work')
    const launchFor = vi.fn((runtime: string, account?: string) => store.launch(runtime, account, launch))
    const request = await terminalRequestFor('mission_a', { liveMissionIds: () => [], getMission: async () => ({ runtime: 'codex', model: 'account-default', account: a.id, session: 'thread-a' }), ownerOf: async () => undefined, cwdFor: async () => undefined, workspacePath: directory, launchFor })
    expect(launchFor).toHaveBeenCalledWith('codex', a.id)
    expect('launch' in request && request.launch.env?.CODEX_HOME).toBe(join(directory, 'agent-accounts', a.id))
  })
})
