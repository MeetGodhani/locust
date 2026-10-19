import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createFileMissionLedger } from '@teammate/mission-store'
import type { RuntimeDiscovery, RuntimeProcessCompletion, RuntimeProcessRunner } from '@teammate/runtime-adapters'
import { createReferenceStore } from './conversation-references.js'
import { createCodexMissionService } from './codex-mission.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

it('briefs the same reference on later turns and never adds it to another conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'locust-reference-brief-')); roots.push(root)
  const project = join(root, 'project'), reference = join(root, 'reference')
  await mkdir(project); await mkdir(reference)
  const ledger = createFileMissionLedger({ rootDirectory: join(root, 'ledger') })
  const references = createReferenceStore({ root, parent: async (id) => (await ledger.getMission(id))?.metadata.continuesFrom?.missionId, pickFolder: async () => reference })
  const item = (await references.folder())!
  const runtime: RuntimeDiscovery = {
    id: 'codex', kind: 'agent-runtime', displayName: 'Codex CLI', optional: false, availability: 'available', readiness: 'ready',
    executable: { commandName: 'codex', discoveredPath: 'agent', executablePath: 'agent', prefixArgs: [], kind: 'native' },
    version: { raw: '0.151.0', version: '0.151.0', major: 0, minor: 151, patch: 0 },
    supportedFeatures: ['non-interactive', 'jsonl-events', 'stdin-prompt', 'workspace-selection', 'read-only-sandbox'], requiredFeatures: [], diagnostics: []
  }
  const completion: RuntimeProcessCompletion = { exitCode: 0, signal: null, stderr: '', stderrTruncated: false, recordCount: 2, cancelled: false, forcedTerminationAttempted: false, terminationUnconfirmed: false, inputDeliveryFailed: false, outputLimitExceeded: false, oversizedRecordsDropped: 0, startedAt: '2026-10-19T12:00:00.000Z', finishedAt: '2026-10-19T12:00:01.000Z' }
  const runner: RuntimeProcessRunner = { start: vi.fn((_command, _prompt) => ({
    records: { async *[Symbol.asyncIterator]() { yield { sequence: 1, raw: JSON.stringify({ type: 'thread.started', thread_id: 'thread_reference' }) }; yield { sequence: 2, raw: JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) } }, drainAvailable: () => [] },
    completion: Promise.resolve(completion)
  })) }
  const scheduled: (() => void)[] = []
  let id = 0
  const service = createCodexMissionService({ workspacePath: project, discover: async () => [runtime], ledger, references, runner, createId: () => String(++id), schedule: (task) => scheduled.push(task), autoModeAllowed: async () => true })
  const send = async (prior?: string, ids?: readonly string[], mode: 'ask' | 'auto' = 'ask') => {
    const started = await service.start('Read the reference.', 'codex', mode, {}, () => undefined, undefined, undefined, prior, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, ids)
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error(started.error.message)
    scheduled.splice(0).forEach((task) => task())
    await vi.waitFor(() => expect(service.hasMission(started.data.missionId)).toBe(false))
    return started.data
  }
  try {
    const first = await send(undefined, [item.id])
    const second = await send(first.missionId)
    expect(vi.mocked(runner.start).mock.calls[0]![1]).toContain('for reading, not changing')
    expect(vi.mocked(runner.start).mock.calls[1]![1]).toContain(JSON.stringify(reference))
    await send()
    expect(vi.mocked(runner.start).mock.calls[2]![1]).not.toContain(JSON.stringify(reference))
    await send(second.missionId, undefined, 'auto')
    expect(vi.mocked(runner.start).mock.calls[3]![1]).toContain(JSON.stringify(reference))
    expect(vi.mocked(runner.start).mock.calls[3]![0].args).toContain('danger-full-access')
    await references.set(first.missionId, [])
    await send(second.missionId)
    expect(vi.mocked(runner.start).mock.calls[4]![1]).toContain('earlier references are not attached now')
  } finally { await service.dispose() }
})
