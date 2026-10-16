import { join } from 'node:path'

import type { CommandResult, ExecutableLaunch, ProbeCommand } from '@teammate/runtime-adapters'
import { describe, expect, it } from 'vitest'

import { createOpenCodeFirstStart, openCodeConfigFolder, openCodeIsSetUp } from './opencode-first-start.js'

/*
 * OPENCODE SETS ITSELF UP BEFORE THE FIRST MESSAGE (0.780). On a clean machine OpenCode's first start installed its
 * plugin package and the first message waited 89 s for it (clean-machine drive, packaged 0.779). Locust now runs
 * `opencode debug config`, naming the run's own guard plugin, once, as soon as OpenCode is found ready.
 */
const FOLDER = join('C:', 'home', '.config', 'opencode')
const MARKER = join(FOLDER, 'node_modules', '@opencode-ai', 'plugin')
const launch: ExecutableLaunch = {
  commandName: 'opencode',
  discoveredPath: 'C:\\profile\\npm\\opencode.cmd',
  executablePath: 'C:\\Locust\\Locust.exe',
  prefixArgs: ['C:\\profile\\npm\\node_modules\\opencode-ai\\bin\\opencode'],
  kind: 'node-shim',
  env: { ELECTRON_RUN_AS_NODE: '1' }
}

function harness(options: { readonly setUp?: boolean; readonly installs?: boolean; readonly found?: boolean } = {}) {
  const files = new Set(options.setUp === true ? [MARKER] : [])
  const ran: ProbeCommand[] = []
  let release: (() => void) | undefined
  const firstStart = createOpenCodeFirstStart({
    locate: async () => (options.found === false ? undefined : launch),
    plugin: async () => 'file:///C:/profile/opencode-command-guard.js',
    run: (command) => {
      ran.push(command)
      return new Promise<CommandResult>((resolve) => {
        release = () => {
          if (options.installs !== false) files.add(MARKER)
          resolve({ exitCode: 0, stdout: '{}', stderr: '' })
        }
      })
    },
    folder: () => FOLDER,
    exists: (path) => files.has(path)
  })
  return { firstStart, ran, finish: () => release?.() }
}

describe('OpenCode, set up before the first message', () => {
  it('runs debug config once, naming the guard plugin, through the launch it was found with', async () => {
    const { firstStart, ran, finish } = harness()
    expect(firstStart.willSetUp()).toBe(true)
    const outcome = firstStart.ensure()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ran).toHaveLength(1)
    expect(ran[0]?.executablePath).toBe('C:\\Locust\\Locust.exe')
    expect(ran[0]?.args).toEqual(['C:\\profile\\npm\\node_modules\\opencode-ai\\bin\\opencode', 'debug', 'config'])
    expect(ran[0]?.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(JSON.parse(ran[0]?.env?.OPENCODE_CONFIG_CONTENT ?? '{}')).toEqual({ plugin: ['file:///C:/profile/opencode-command-guard.js'] })
    finish()
    expect(await outcome).toBe('set-up')
    expect(firstStart.willSetUp()).toBe(false)
  })

  it('does nothing where OpenCode is already set up', async () => {
    const { firstStart, ran } = harness({ setUp: true })
    expect(await firstStart.ensure()).toBe('already')
    expect(firstStart.willSetUp()).toBe(false)
    expect(ran).toHaveLength(0)
  })

  it('shares one run between calls made while it is going', async () => {
    const { firstStart, ran, finish } = harness()
    const first = firstStart.ensure()
    const second = firstStart.ensure()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ran).toHaveLength(1)
    finish()
    expect(await first).toBe('set-up')
    expect(await second).toBe('set-up')
  })

  it('tries once a launch when the install does not land', async () => {
    const { firstStart, ran, finish } = harness({ installs: false })
    const outcome = firstStart.ensure()
    await new Promise((resolve) => setTimeout(resolve, 0))
    finish()
    expect(await outcome).toBe('failed')
    expect(await firstStart.ensure()).toBe('tried')
    expect(ran).toHaveLength(1)
    expect(firstStart.willSetUp()).toBe(true)
  })

  it('runs nothing when OpenCode is not found', async () => {
    const { firstStart, ran } = harness({ found: false })
    expect(await firstStart.ensure()).toBe('not-found')
    expect(ran).toHaveLength(0)
  })
})

describe("OpenCode's config folder", () => {
  it('is XDG_CONFIG_HOME when set, else .config under home', () => {
    expect(openCodeConfigFolder({ XDG_CONFIG_HOME: join('D:', 'xdg') }, join('C:', 'home'))).toBe(join('D:', 'xdg', 'opencode'))
    expect(openCodeConfigFolder({}, join('C:', 'home'))).toBe(join('C:', 'home', '.config', 'opencode'))
    expect(openCodeIsSetUp(FOLDER, (path) => path === MARKER)).toBe(true)
    expect(openCodeIsSetUp(FOLDER, () => false)).toBe(false)
  })
})

describe('the start line while it does', () => {
  it('says the agent is setting itself up, and roughly how long', async () => {
    const { startPhaseLabel } = await import('../shared/start-phase.js')
    expect(startPhaseLabel('runtime-first-setup', 'OpenCode')).toBe('Setting up OpenCode for its first start, about a minute')
    expect(startPhaseLabel('starting-runtime', 'OpenCode')).toBe('Starting OpenCode')
  })
})
