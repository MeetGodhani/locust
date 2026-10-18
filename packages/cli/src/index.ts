#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createAcpAgent } from './acp.js'
import { LocustClient, LocalError, profileDirectory, TextStream } from './client.js'

const HELP = `Usage: locust [--profile <Locust profile folder>] teammates | status | send <teammate> "<message>" | acp [--teammate <name or id>]
Locust must already be open, with Settings > General > Let your other AI apps use Locust on.
Turns use Ask mode unless Use each teammate's own mode is on in Locust. Cards are answered in Locust; an editor
answers its own turn's cards only when Let editors answer cards for their own turns is on. This command never signs
in or changes settings.`

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const args = [...argv]
  let profile: string | undefined
  const profileAt = args.indexOf('--profile')
  if (profileAt >= 0) {
    const value = args[profileAt + 1]
    if (!value || value.startsWith('--')) { process.stderr.write(`${HELP}\n`); return 2 }
    profile = resolve(value)
    args.splice(profileAt, 2)
  }
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') { process.stdout.write(`${HELP}\n`); return 0 }
  const client = new LocustClient(profile ?? profileDirectory())
  if (args[0] === 'acp') {
    if (args.length !== 1 && !(args.length === 3 && args[1] === '--teammate')) throw new LocalError(HELP)
    let buffer = ''
    let failed = false
    const agent = createAcpAgent({ client, ...(args[2] === undefined ? {} : { teammate: args[2] }),
      send: message => {
        if (process.stdout.writableLength > 2 * 1024 * 1024) { failed = true; process.stdin.destroy(); void agent.close(); return }
        process.stdout.write(`${JSON.stringify(message)}\n`)
      }, diagnostic: text => process.stderr.write(`${text}\n`) })
    process.stdin.setEncoding('utf8')
    const onData = (chunk: string) => {
      buffer += chunk
      while (true) {
        const end = buffer.indexOf('\n')
        if (end < 0) break
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        if (Buffer.byteLength(line) > 256 * 1024) { failed = true; process.stdin.destroy(); return }
        if (line.trim()) agent.accept(line)
      }
      if (Buffer.byteLength(buffer) > 256 * 1024) { failed = true; process.stdin.destroy() }
    }
    process.stdin.on('data', onData)
    await new Promise<void>(done => {
      const finish = () => { void agent.close().finally(done) }
      process.stdin.once('end', finish)
      process.stdin.once('close', finish)
      process.stdin.once('error', finish)
      process.once('SIGINT', () => { failed = true; process.stdin.pause(); finish() })
    })
    process.stdin.off('data', onData)
    if (failed) process.stderr.write('The ACP connection ended or its input was too large. Check Locust before sending again.\n')
    return failed ? 1 : 0
  }
  if (args[0] === 'teammates' && args.length === 1) {
    const team = await client.teammates()
    process.stdout.write(team.length ? `${team.map(t => `${t.name}\t${t.id}\t${t.runtime ?? 'agent not set'}\t${t.model ?? 'model not set'}\t${t.runs_in}`).join('\n')}\n` : 'No teammates yet. Add a teammate in Locust.\n')
    return 0
  }
  if (args[0] === 'status' && args.length === 1) {
    const state = await client.status()
    process.stdout.write(state.turns.length ? `${state.turns.map(t => `${t.state}\t${t.teammate}\t${t.missionId}`).join('\n')}\n` : 'Nothing is running or waiting in Locust.\n')
    return 0
  }
  if (args[0] === 'send' && args.length === 3) {
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    const seen = new Set<string>()
    try {
      const session = await client.open(args[1])
      try {
        const stream = new TextStream(text => {
          if (process.stdout.writableLength > 2 * 1024 * 1024) throw new LocalError('The terminal did not keep up with the reply. Read it in Locust.')
          process.stdout.write(text)
        })
        const ended = await client.prompt(session, args[2]!, { signal: controller.signal, onText: event => stream.accept(event), onApprovals: cards => {
          for (const card of cards) if (!seen.has(card.approvalId)) { seen.add(card.approvalId); process.stderr.write(`Waiting for you in Locust: ${card.summary}\n`) }
        } })
        process.stdout.write('\n')
        return ended === 'cancelled' ? 130 : 0
      } finally { await client.close(session) }
    } finally { process.off('SIGINT', stop) }
  }
  process.stderr.write(`${HELP}\n`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code }, error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Locust could not finish. Check the conversation in Locust.'}\n`)
    process.exitCode = 1
  })
}
