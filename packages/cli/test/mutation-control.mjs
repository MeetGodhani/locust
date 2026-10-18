// Break one boundary at a time, require its named assertion to fail, and restore exact source bytes.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const CLI = join(ROOT, 'packages/cli')
const DESKTOP = join(ROOT, 'apps/desktop')
const VITEST = join(ROOT, 'node_modules/vitest/vitest.mjs')
const CLIENT = join(CLI, 'src/client.ts')
const ACP = join(CLI, 'src/acp.ts')
const SESSIONS = join(DESKTOP, 'src/main/locust-cli-sessions.ts')
const COMMAND_TEST = 'test/the-command-talks-only-to-locust.test.ts'
const ACP_TEST = 'test/an-editor-can-talk-to-a-locust-teammate.test.ts'
const SESSION_TEST = 'src/main/a-cli-session-controls-only-its-own-turn.test.ts'
const CASES = [
  { name: 'final text is duplicated', file: CLIENT, from: 'this.write(after.slice(before.length))', to: 'this.write(after)', cwd: CLI, test: COMMAND_TEST, assertion: 'prints incremental text once, not again for the final replacement' },
  { name: 'an unknown permission option allows', file: ACP, from: "outcome.outcome === 'selected' && outcome.optionId === 'allow' && message.error === undefined", to: "outcome.outcome === 'selected' && message.error === undefined", cwd: CLI, test: ACP_TEST, assertion: 'maps permission outcome not-an-option to at most one once-only decision' },
  { name: 'editor programs are accepted', file: ACP, from: 'params.mcpServers.length !== 0', to: 'false', cwd: CLI, test: ACP_TEST, assertion: 'rejects files, editor MCP programs and unknown sessions before starting' },
  { name: 'a wrong capability is accepted', file: SESSIONS, from: '!timingSafeEqual(Buffer.from(args.key), Buffer.from(session.public.key))', to: 'false', cwd: DESKTOP, test: SESSION_TEST, assertion: 'rejects a wrong capability for reading, cancellation and decisions' },
  { name: 'another run’s card is exposed', file: SESSIONS, from: ' && a.runId === turn.state.runId', to: '', cwd: DESKTOP, test: SESSION_TEST, assertion: 'answers only its own current action, never another run or a question' },
  { name: 'a late start escapes cancellation', file: SESSIONS, from: 'if (turn.stopped || session.closed || disposed) options.cancel(result.data.runId)', to: 'if (false) options.cancel(result.data.runId)', cwd: DESKTOP, test: SESSION_TEST, assertion: 'cancels a late start using its returned run id, not a client-supplied one' },
  { name: 'an early cancellation is forgotten', file: SESSIONS, from: 'const wasCancelled = session.cancelledRequests.delete(args.requestId)', to: 'const wasCancelled = false', cwd: DESKTOP, test: SESSION_TEST, assertion: 'does not start when a cancellation arrives before its prompt request' },
  { name: 'an old prompt is replayed', file: SESSIONS, from: 'if (session.requests.has(args.requestId))', to: 'if (false)', cwd: DESKTOP, test: SESSION_TEST, assertion: 'does not replay an older request id after another turn completed' }
]

const scratch = mkdtempSync(join(tmpdir(), 'locust-cli-controls-'))
const report = join(scratch, 'result.json')
function run(cwd, file) {
  rmSync(report, { force: true })
  const ran = spawnSync(process.execPath, [VITEST, 'run', file, '--reporter=json', '--outputFile', report], { cwd, encoding: 'utf8', timeout: 60_000 })
  if (ran.error || !ran.status && !ran.stdout.includes('JSON report written') || !readable(report)) throw Error(`Test runner failed: ${ran.error?.message ?? ran.stderr}`)
  return { status: ran.status, report: JSON.parse(readFileSync(report, 'utf8')) }
}
function readable(path) { try { readFileSync(path); return true } catch { return false } }
let caught = 0
try {
  for (const [cwd, file] of [[CLI, COMMAND_TEST], [CLI, ACP_TEST], [DESKTOP, SESSION_TEST]]) {
    const baseline = run(cwd, file)
    if (baseline.status !== 0 || baseline.report.numTotalTests < 1 || baseline.report.numFailedTestSuites !== 0) throw Error(`Baseline is not green: ${file}`)
  }
  for (const control of CASES) {
    const original = readFileSync(control.file, 'utf8')
    if (original.split(control.from).length !== 2) throw Error(`Control anchor is not unique: ${control.name}`)
    try {
      writeFileSync(control.file, original.replace(control.from, control.to), 'utf8')
      const mutated = run(control.cwd, control.test)
      const assertions = mutated.report.testResults.flatMap(result => result.assertionResults ?? [])
      const failed = assertions.find(assertion => assertion.fullName.includes(control.assertion) && assertion.status === 'failed' && assertion.failureMessages.some(message => /AssertionError|expect\(|__VITEST_REJECTS__/.test(message)))
      if (mutated.status === 0 || assertions.length < 1 || !failed) {
        process.stderr.write(JSON.stringify(assertions.filter(a => a.status === 'failed').map(a => ({ name: a.fullName, messages: a.failureMessages.map(m => m.slice(0, 800)) })), null, 2) + '\n')
        throw Error(`Named assertion did not catch: ${control.name}`)
      }
      caught++
      process.stdout.write(`CAUGHT: ${control.name}\n`)
    } finally { writeFileSync(control.file, original, 'utf8') }
  }
  for (const [cwd, file] of [[CLI, COMMAND_TEST], [CLI, ACP_TEST], [DESKTOP, SESSION_TEST]]) {
    if (run(cwd, file).status !== 0) throw Error(`Restored suite failed: ${file}`)
  }
  process.stdout.write(`${caught}/${CASES.length} mutation controls caught; restored suites passed.\n`)
} finally { rmSync(scratch, { force: true, recursive: true }) }
