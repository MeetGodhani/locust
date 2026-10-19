// No model turn. Real import IPC/ledger/UI, synthetic CLI output and chat homes.
// --negative-control withholds the new sources; the new-agent row checks must fail.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { say, scratchRepository, startDrive } from './drive-lib.mjs'

const workspace = await scratchRepository('locust-drive-import-more-')
const home = join(workspace, 'home')
const bin = join(workspace, 'bin')
const cwd = join(workspace, 'project')
await Promise.all([home, bin, cwd, join(home, 'Documents'), join(home, 'Desktop'), join(home, 'Downloads')].map(folder => mkdir(folder, { recursive: true })))
const at = Date.now() - 3600000
const negativeControl = process.argv.includes('--negative-control')
const cursorId = '026f3a83-d3a2-4e27-865f-0f4d492f7d0a'
const ocId = 'ses_fixture123'
const cursor = join(home, '.cursor', 'chats', '0'.repeat(32), cursorId)
await mkdir(cursor, { recursive: true })
await writeFile(join(cursor, 'meta.json'), JSON.stringify({ schemaVersion: 1, hasConversation: !negativeControl, cwd, createdAtMs: at, updatedAtMs: at + 5000 }))
const db = new DatabaseSync(join(cursor, 'store.db'))
db.exec('CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)')
const put = bytes => { const id = createHash('sha256').update(bytes).digest(); db.prepare('INSERT INTO blobs VALUES (?, ?)').run(id.toString('hex'), bytes); return id }
const ids = [
  { role: 'user', content: [{ type: 'text', text: '<user_query>Plan the Cursor chart</user_query>' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Cursor chart plan imported.' }] }
].map(message => put(Buffer.from(JSON.stringify(message))))
const root = put(Buffer.concat(ids.map(id => Buffer.concat([Buffer.from([10, 32]), id]))))
db.prepare('INSERT INTO meta VALUES (?, ?)').run('0', Buffer.from(JSON.stringify({ agentId: cursorId, name: 'Cursor fixture chart', latestRootBlobId: root.toString('hex') })).toString('hex'))
db.close()
const cursorBefore = await readFile(join(cursor, 'store.db'))
const ocRows = negativeControl ? [] : [{ id: ocId, title: 'OpenCode fixture chart', directory: cwd, updated: at + 5000 }, { id: 'ses_missing123', title: 'Missing folder fixture', directory: join(workspace, 'gone'), updated: at }]
const ocExport = { info: { id: ocId }, messages: [
  { info: { id: 'u1', sessionID: ocId, role: 'user', time: { created: at } }, parts: [{ type: 'text', text: 'Plan the OpenCode chart' }] },
  { info: { sessionID: ocId, role: 'assistant', parentID: 'u1', finish: 'stop', time: { completed: at + 5000 } }, parts: [{ type: 'text', text: 'OpenCode chart plan imported.' }] }
] }
const log = join(workspace, 'cli-calls.jsonl')
await writeFile(join(bin, 'fixture.cjs'), `const fs = require('node:fs'); const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+String.fromCharCode(10)); if (args.join(' ') === 'session list --format json') console.log(${JSON.stringify(JSON.stringify(ocRows))}); else if(args.join(' ') === 'export ${ocId}') console.log(${JSON.stringify(JSON.stringify(ocExport))}); else process.exit(41);`)
await writeFile(join(bin, 'opencode.cmd'), `@echo off\r\n"${process.execPath}" "${join(bin, 'fixture.cjs')}" %*\r\n`)
const claude = join(home, '.claude', 'projects', 'fixture')
await mkdir(claude, { recursive: true })
await writeFile(join(claude, 'aaaaaaaa-0000-4000-8000-000000000001.jsonl'), JSON.stringify({ type: 'user', entrypoint: 'cli', sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', cwd, timestamp: new Date(at).toISOString(), message: { content: 'Claude fixture chart' } }) + '\n')
const date = new Date(at)
const codex = join(home, '.codex', 'sessions', String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0'))
await mkdir(codex, { recursive: true })
await writeFile(join(codex, 'rollout-fixture-bbbbbbbb-0000-4000-8000-000000000002.jsonl'), [
  { type: 'session_meta', payload: { id: 'bbbbbbbb-0000-4000-8000-000000000002', cwd, originator: 'codex_cli_rs', source: 'cli' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Codex fixture chart' }] } }
].map(row => JSON.stringify(row)).join('\n') + '\n')
// Fixture-only PATH and install roots keep discovery out of the person's CLIs.
process.env.LOCUST_DRIVE_PATH_FIRST = bin
const drive = await startDrive({ name: negativeControl ? 'import-more-sessions-negative' : 'import-more-sessions', port: 9837, workspace, sendsNothing: true,
  env: { USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), PATH: `${bin};${dirname(process.execPath)};${process.env.SystemRoot}\\System32`, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), LOCUST_DEFAULT_WORKSPACE: cwd },
  seed: { schemaVersion: 1, teammates: [{ teammateId: 'tm_fixture', name: 'Fixture', hue: 'clay', role: 'Code & Migrations', createdAt: new Date(at).toISOString(), route: { runtime: 'codex', model: 'account-default', mode: 'ask' } }], missionOwners: {}, settings: { swarm: false, relay: false, memoryMode: 'off' } }
})
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; say(`[${ok ? 'PASS' : 'FAIL'}] ${name} ${detail}`) }
const openList = async () => {
  await drive.evaluate(`(() => { const add = [...document.querySelectorAll('button')].find(b => /^(Add|New teammate or room|Add teammate)/i.test(b.getAttribute('aria-label') ?? '') || b.title === 'Add'); if (!add) throw new Error('Add menu button not found'); add.click() })()`)
  await drive.waitFor(`!![...document.querySelectorAll('[role="menuitem"], button')].find(b => b.textContent.includes('Import a conversation'))`)
  await drive.evaluate(`[...document.querySelectorAll('[role="menuitem"], button')].find(b => b.textContent.includes('Import a conversation')).click()`)
  await drive.waitFor(`document.querySelectorAll('.lc-importdialog__row').length > 0`)
}
try {
  await drive.resize(1200, 720)
  await drive.capture('ready', () => drive.ready())
  await openList()
  const rows = JSON.parse(await drive.capture('four agent sources and a missing folder', () => drive.evaluate(`JSON.stringify([...document.querySelectorAll('.lc-importdialog__row')].map(row => ({ text: row.innerText, mark: row.querySelector('svg')?.getAttribute('data-runtime'), disabled: row.querySelector('button')?.disabled })))`)))
  for (const runtime of ['claude', 'codex', 'cursor', 'opencode']) check(`${runtime} has a marked import row`, rows.some(row => row.mark === runtime))
  check('missing folder is explained and cannot import', rows.some(row => row.text.includes('Missing folder fixture') && row.text.includes('folder no longer available') && row.disabled))
  if (negativeControl) {
    if (failures === 0) throw new Error('Negative control was not detected')
  } else {
    for (const [runtime, answer] of [['opencode', 'OpenCode chart plan imported.'], ['cursor', 'Cursor chart plan imported.']]) {
      if (runtime === 'cursor') await openList()
      await drive.evaluate(`document.querySelector('.lc-importdialog__row svg[data-runtime="${runtime}"]').closest('li').querySelector('button').click()`)
      await drive.waitFor(`!document.querySelector('.lc-importdialog') && document.body.innerText.includes(${JSON.stringify(answer)})`)
      const visible = await drive.capture(`${runtime} imported conversation opens`, () => drive.evaluate(`document.body.innerText`))
      check(`${runtime} conversation shows imported answer`, String(visible).includes(answer))
    }
    check('Cursor store bytes unchanged', cursorBefore.equals(await readFile(join(cursor, 'store.db'))))
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    check('only read commands ran, with no model selection', calls.every(args => ['--version', '--help', 'run --help', 'models', 'models --verbose', 'session list --format json', `export ${ocId}`].includes(args.join(' '))), JSON.stringify(calls))
  }
} catch (error) { check('drive completes', false, error.stack ?? String(error)) }
finally { await drive.finish({ intro: 'Fixture homes and read-only CLI output; no sign-in, config read or model turn. Compact 1200×720 capture.', extra: `Failed checks: ${failures}.` }) }
if (failures) process.exitCode = 1
