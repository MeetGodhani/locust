import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createFileMissionLedger, type MissionLedgerMetadata } from '@teammate/mission-store'
import { readOneMission } from './mission-history.js'
import { LEFT_OUT, BACKED_UP_FILES } from './profile-backup.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
describe('an other-app origin survives a restart', () => {
  it('records schema 23, recovers the origin, and projects it into history without forgetting Ask mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-mcp-ledger-')); roots.push(directory)
    const metadata: MissionLedgerMetadata = { missionId: 'mission_1', runId: 'run_1', prompt: 'Review this', runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId: 'ws_test', sandbox: 'read-only', mode: 'ask', executionPolicyVersion: 1, createdAt: '2026-10-07T00:00:00Z', startedBy: { kind: 'mcp' } }
    const ledger = createFileMissionLedger({ rootDirectory: directory })
    await ledger.createMission(metadata); await ledger.flush()
    const fresh = createFileMissionLedger({ rootDirectory: directory })
    const answer = await readOneMission(fresh, undefined, 'mission_1')
    expect(answer.ok && answer.data.mission.startedBy).toEqual({ kind: 'mcp' })
    expect(answer.ok && answer.data.mission.mode).toBe('ask')
    const file = join(directory, 'mission_1.jsonl')
    const header = JSON.parse((await readFile(file, 'utf8')).split('\n')[0]!)
    expect(header.schemaVersion).toBe(23)
    header.schemaVersion = 22
    await writeFile(file, JSON.stringify(header) + '\n')
    const old = await createFileMissionLedger({ rootDirectory: directory }).getMission('mission_1')
    expect(old).toBeUndefined() // an older writer never claimed this new origin
  })
  it('keeps a voice call’s hand-off as one, across a restart (0.739)', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'locust-mcp-ledger-')); roots.push(directory)
    const metadata: MissionLedgerMetadata = { missionId: 'mission_2', runId: 'run_2', prompt: 'Fix the login loop', runtime: 'codex', model: 'account-default', requestedRouteId: 'codex', resolvedRouteId: 'codex-account:default', cliVersion: null, workspaceId: 'ws_test', sandbox: 'workspace-write', mode: 'accept-edits', executionPolicyVersion: 1, createdAt: '2026-10-11T00:00:00Z', startedBy: { kind: 'mcp', via: 'voice' } }
    const ledger = createFileMissionLedger({ rootDirectory: directory })
    await ledger.createMission(metadata); await ledger.flush()
    const answer = await readOneMission(createFileMissionLedger({ rootDirectory: directory }), undefined, 'mission_2')
    expect(answer.ok && answer.data.mission.startedBy).toEqual({ kind: 'mcp', via: 'voice' })
    // Still the same schema: an older Locust reads it as "another app", which is still true.
    expect(JSON.parse((await readFile(join(directory, 'mission_2.jsonl'), 'utf8')).split('\n')[0]!).schemaVersion).toBe(23)
  })
  it('makes the external origin visible in the thread and keeps the actual ask as a message', async () => {
    const thread = await readFile(fileURLToPath(new URL('../renderer/src/components/Thread.tsx', import.meta.url)), 'utf8')
    expect(thread).toContain("const from = via === 'voice' ? 'Started from a voice call' : 'Started from another app'")
    expect(thread).toContain('return `${from} · Ask mode (read only)`')
    // Said only when the conversation BEGAN in another app or a call: drawn and checked in
    // renderer/src/a-call-joined-later-is-not-where-it-began.test.tsx (0.750; the source pin here passed 0.748's bug).
  })
  it('classifies the token file and opt-in as excluded from every profile backup', () => {
    expect(LEFT_OUT['locust-mcp-connection.json']).toContain('token')
    expect(LEFT_OUT['locust-mcp.json']).toContain('enable again')
    expect(BACKED_UP_FILES).not.toContain('locust-mcp-connection.json')
    expect(BACKED_UP_FILES).not.toContain('locust-mcp.json')
  })
})
