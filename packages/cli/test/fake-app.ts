import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { LocustClient } from '../src/client.js'
import type { CliSession, CliTeammate } from '../src/protocol.js'

export type Fields = Record<string, unknown>
export const TEAM: readonly CliTeammate[] = [
  { id: 'mate-one', name: 'One', runtime: 'codex', model: 'test-model', runs_in: 'ask' },
  { id: 'mate-two', name: 'Two', runtime: 'claude', model: 'other-model', runs_in: 'ask' }
]
export const session = (id = 'session-one', teammate = TEAM[0]!): CliSession => ({ sessionId: id, key: randomBytes(32).toString('hex'), teammate, workspace: process.cwd() })
const disposers: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(disposers.splice(0).map(dispose => dispose())) })

export async function fakeApp(handler: (name: string, args: Fields, res: ServerResponse) => unknown | Promise<unknown>, timeout = 2_000) {
  const profile = await mkdtemp(join(tmpdir(), 'locust-cli-test-'))
  const token = randomBytes(32).toString('hex')
  const requests: { name: string; args: Fields }[] = []
  const app = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const { name, arguments: args } = JSON.parse(Buffer.concat(chunks).toString()) as { name: string; arguments: Fields }
      requests.push({ name, args })
      const value = await handler(name, args, res)
      if (value !== undefined && !res.writableEnded) res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }))
    })().catch(() => { if (!res.destroyed) res.writeHead(500).end() })
  })
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  const address = app.address()
  if (!address || typeof address === 'string') throw Error('no fake server')
  const url = `http://127.0.0.1:${address.port}/tools/call`
  await writeFile(join(profile, 'locust-mcp-connection.json'), JSON.stringify({ url, token }))
  disposers.push(async () => { app.closeAllConnections(); await new Promise<void>(resolve => app.close(() => resolve())); await rm(profile, { force: true, recursive: true }) })
  return { profile, requests, url, client: new LocustClient(profile, timeout) }
}
