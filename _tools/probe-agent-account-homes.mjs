// No login and no model turn. Only throwaway homes are passed to the installed CLIs.
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createNodeProbeRunner, createPathExecutableLocator } from '../packages/runtime-adapters/dist/index.js'

const root = await mkdtemp(resolve('.tmp/account-home-probe-'))
const locator = createPathExecutableLocator()
const runner = createNodeProbeRunner()
const observed = []
for (const runtime of ['claude', 'codex']) {
  const launch = await locator.find(runtime)
  if (!launch) throw new Error(`${runtime} was not found`)
  const homes = [join(root, `${runtime}-a`), join(root, `${runtime}-b`)]
  for (const home of homes) await mkdir(home, { recursive: true })
  const run = (home, args) => runner.run({ purpose: 'readiness', executablePath: launch.executablePath,
    args: [...launch.prefixArgs, ...args], timeoutMs: 30_000,
    env: { ...launch.env, ...(runtime === 'claude' ? { CLAUDE_CONFIG_DIR: home, CLAUDE_CODE_OAUTH_TOKEN: '', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' }
      : { CODEX_HOME: home, CODEX_SQLITE_HOME: home, OPENAI_API_KEY: '', CODEX_API_KEY: '', CODEX_ACCESS_TOKEN: '', OPENAI_ACCESS_TOKEN: '' }) } })
  const version = await run(homes[0], ['--version'])
  if (runtime === 'claude') {
    for (const home of homes) {
      const status = await run(home, ['auth', 'status'])
      const value = JSON.parse(status.stdout)
      if (value.loggedIn !== false) throw new Error('The throwaway Claude home unexpectedly reports a sign-in')
      if (value.configDirectory !== undefined && resolve(value.configDirectory) !== home) throw new Error('Claude did not use the requested home')
      observed.push({ runtime, version: version.stdout.trim(), home, exitCode: status.exitCode, loggedIn: value.loggedIn, configDirectory: value.configDirectory ?? 'not reported by this version' })
    }
  } else {
    const features = await run(homes[0], ['features', 'list'])
    const feature = /^([a-z_]+)\s+stable\s+/m.exec(features.stdout)?.[1]
    if (!feature) throw new Error('Codex listed no stable feature to measure its configuration directory')
    const first = await run(homes[0], ['features', 'disable', feature])
    if (first.exitCode !== 0) throw new Error('Codex could not write its throwaway configuration')
    if (!(await stat(join(homes[0], 'config.toml'))).isFile()) throw new Error('Codex did not write in CODEX_HOME')
    if (await stat(join(homes[1], 'config.toml')).then(() => true, () => false)) throw new Error('Codex wrote in the other home')
    const second = await run(homes[1], ['features', 'disable', feature])
    if (second.exitCode !== 0 || !(await stat(join(homes[1], 'config.toml'))).isFile()) throw new Error('Codex did not switch homes')
    for (const home of homes) {
      const status = await run(home, ['login', 'status'])
      if (status.exitCode === 0) throw new Error('The throwaway Codex home unexpectedly reports a sign-in')
      observed.push({ runtime, version: version.stdout.trim(), home, exitCode: status.exitCode, configWrittenInRequestedHome: true })
    }
  }
}
await writeFile(join(root, 'result.json'), JSON.stringify(observed, null, 2))
console.log(JSON.stringify(observed, null, 2))
