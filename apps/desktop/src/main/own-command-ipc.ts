import { ipcMain, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  OWN_COMMAND_ALLOW,
  OWN_COMMAND_DONE,
  OWN_COMMAND_EXPAND,
  OWN_COMMAND_LIST,
  OWN_COMMAND_OPEN,
  OWN_COMMAND_RUN,
  OWN_COMMAND_STOP,
  type CommandContext
} from '../shared/own-commands.js'
import type { createOwnCommandHost } from './own-command-host.js'
import { ensureCommandDir } from './own-command-host.js'

type Host = ReturnType<typeof createOwnCommandHost>

const CONTEXT_KEYS = new Set(['missionId', 'teammateId'])

function contextOf(value: Record<string, unknown>): CommandContext | undefined {
  const missionId = value.missionId
  const teammateId = value.teammateId
  if (missionId !== undefined && (typeof missionId !== 'string' || missionId.length === 0 || missionId.length > 128)) return undefined
  if (teammateId !== undefined && (typeof teammateId !== 'string' || teammateId.length === 0 || teammateId.length > 128)) return undefined
  return {
    ...(typeof missionId === 'string' ? { missionId } : {}),
    ...(typeof teammateId === 'string' ? { teammateId } : {})
  }
}

/** Only the keys a channel is allowed to carry. A folder or a shell is never one of them. */
function recordOf(value: unknown, allowed: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = new Set([...CONTEXT_KEYS, ...allowed])
  if (Object.keys(record).some((key) => !keys.has(key))) return undefined
  return record
}

/**
 * Every channel is the window's. The payload is command text and identities.
 * The host decides the folder and the shell.
 */
export function registerOwnCommandIpc(host: Host, own: (event: IpcMainInvokeEvent) => boolean, openPath: (dir: string) => Promise<string> = (dir) => shell.openPath(dir)): void {
  const refused = { ok: false as const, message: 'Only Locust’s window can run a command.' }
  ipcMain.handle(OWN_COMMAND_LIST, async (event, payload: unknown) => {
    if (!own(event)) return refused
    const record = recordOf(payload ?? {}, [])
    if (record === undefined) return { ok: false, message: 'The command request was refused.' }
    const context = contextOf(record)
    if (context === undefined) return { ok: false, message: 'The command request was refused.' }
    return { ok: true, commands: await host.list(context) }
  })
  ipcMain.handle(OWN_COMMAND_EXPAND, async (event, payload: unknown) => {
    if (!own(event)) return refused
    const record = recordOf(payload, ['name', 'source', 'arguments'])
    if (record === undefined || typeof record.name !== 'string' || (record.source !== 'global' && record.source !== 'project') || typeof record.arguments !== 'string') {
      return { ok: false, message: 'The command request was refused.' }
    }
    const context = contextOf(record)
    if (context === undefined) return { ok: false, message: 'The command request was refused.' }
    return host.expand(context, record.name, record.source, record.arguments)
  })
  ipcMain.handle(OWN_COMMAND_ALLOW, async (event, payload: unknown) => {
    if (!own(event)) return refused
    const record = recordOf(payload ?? {}, [])
    if (record === undefined) return { ok: false, message: 'The command request was refused.' }
    const context = contextOf(record)
    if (context === undefined) return { ok: false, message: 'The command request was refused.' }
    return host.allow(context)
  })
  ipcMain.handle(OWN_COMMAND_OPEN, async (event, payload: unknown) => {
    if (!own(event)) return refused
    const record = recordOf(payload, ['which'])
    if (record === undefined || (record.which !== 'global' && record.which !== 'project')) return { ok: false, message: 'The command request was refused.' }
    const context = contextOf(record)
    if (context === undefined) return { ok: false, message: 'The command request was refused.' }
    const dir = await host.directory(record.which, context)
    if (dir === undefined) return { ok: false, message: 'Choose a folder first. There is nowhere to open.' }
    await ensureCommandDir(dir)
    const error = await openPath(dir)
    return error.length === 0 ? { ok: true } : { ok: false, message: error }
  })
  ipcMain.handle(OWN_COMMAND_RUN, async (event, payload: unknown) => {
    if (!own(event)) return refused
    const record = recordOf(payload, ['command'])
    if (record === undefined || typeof record.command !== 'string') return { ok: false, message: 'The command request was refused.' }
    const context = contextOf(record)
    if (context === undefined) return { ok: false, message: 'The command request was refused.' }
    const started = await host.start(context, record.command)
    if (!started.ok) return started
    const sender = event.sender
    void started.done.then((result) => { if (!sender.isDestroyed()) sender.send(OWN_COMMAND_DONE, result) })
    return { ok: true, id: started.id }
  })
  ipcMain.handle(OWN_COMMAND_STOP, (event, id: unknown) => {
    if (own(event) && typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) host.stop(id)
  })
}
