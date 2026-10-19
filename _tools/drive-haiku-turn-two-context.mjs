// How full a Haiku conversation is on its SECOND turn: the person's account connectors' tools, or not.
//
//   LOCUST_SPEND=1 node _tools/drive-haiku-turn-two-context.mjs [--model haiku|sonnet] [--tag <name>]
//
// 2026-10-19: the Compact now drive read 17,642 tokens on a first Haiku turn and 191,740 on a later one. Claude
// Code's own record of that later request held 246 tools, 235 of them from the account's claude.ai connectors (Gmail,
// Drive, Figma, Zapier, ...), which a first turn had not connected yet. Opus and Sonnet put such tools behind tool
// search; Haiku sends every one. Two short Haiku turns, and each turn's receipt read back from the drive's own ledger.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { pickRouteScript, recordRoot, say, scratchRepository, sendAndWaitScript, startDrive, teammateFace } from './drive-lib.mjs'

const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined)
const model = arg('--model') ?? 'haiku'
const tag = arg('--tag') ?? model
const workspace = await scratchRepository('locust-drive-haiku-two-ws-')

const drive = await startDrive({
  name: 'haiku-turn-two-context',
  port: 9418,
  workspace,
  spends: true,
  keep: true,
  outPath: join(recordRoot('haiku-turn-two-context-2026-10-19'), tag),
  seed: {
    schemaVersion: 1,
    teammates: [{ teammateId: 'tm_wren', name: 'Wren', hue: 'lime', role: 'Code & Migrations', createdAt: '2026-09-05T05:00:00.000Z' }],
    missionOwners: {},
    settings: { swarm: false, relay: false, relayHopCap: 2, memoryMode: 'off', autoMode: false }
  }
})

/** Each turn's prompt and how full the conversation was after it, oldest first, from the drive's own ledger. */
async function turns() {
  const dir = join(drive.profile, 'mission-ledger')
  const found = []
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith('.jsonl')) continue
    let prompt = ''
    let at = ''
    let usage
    for (const line of (await readFile(join(dir, file), 'utf8')).split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const record = JSON.parse(line)
        if (typeof record?.metadata?.prompt === 'string') { prompt = record.metadata.prompt; at = record.occurredAt ?? '' }
        if (record?.event?.type === 'run.completed') usage = record.event.payload?.usage
      } catch { /* a torn line */ }
    }
    found.push({ at, prompt: prompt.slice(-40), contextTokens: usage?.contextTokens, cacheReadTokens: usage?.cacheReadTokens })
  }
  return found.sort((a, b) => a.at.localeCompare(b.at))
}

try {
  await drive.capture('Wren on Claude Code / haiku', async () => {
    await drive.ready()
    await drive.resize(1280, 800)
    await drive.evaluate(`(async () => { ${teammateFace('Wren')}?.click(); await new Promise(r => setTimeout(r, 700)) })()`)
    return drive.evaluate(pickRouteScript({ group: '/claude/i', search: model, row: `/${model}/i` }))
  })
  const route = await drive.evaluate(`(() => {
    const control = [...document.querySelectorAll('.lc-control')].find(b => b.getAttribute('aria-haspopup') === 'listbox')
    return control ? control.innerText.replace(/\\s+/g, ' ').trim() : ''
  })()`)
  if (!new RegExp(model, 'i').test(route)) throw new Error(`refusing to send: the composer is on "${route}", not ${model}`)
  await drive.capture('first turn', () => drive.evaluate(sendAndWaitScript('Say hello in five words.', { waitSeconds: 240 })))
  await drive.capture('second turn', () => drive.evaluate(sendAndWaitScript('Now say goodbye in three words.', { waitSeconds: 240 })))
  const read = await turns()
  for (const turn of read) say(`  turn: ${JSON.stringify(turn)}`)
  const [first, second] = read
  say(first !== undefined && second !== undefined
    ? `\nFIRST ${String(first.contextTokens)} / SECOND ${String(second.contextTokens)} tokens`
    : '\nTURNS NOT READ')
} catch (error) {
  say(`drive failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  await drive.finish({ intro: 'Two Claude Code turns on Haiku: how full the conversation is on each.' })
}
