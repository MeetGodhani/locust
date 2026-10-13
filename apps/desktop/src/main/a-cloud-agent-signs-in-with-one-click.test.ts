import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AppServerRunProcess } from '@teammate/runtime-adapters'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CloudSignInStep } from '../shared/cloud-computer.js'
import {
  agentInstallLine,
  cloudLaunchOf,
  createCloudComputers,
  scriptLine,
  signInPage,
  signInScript,
  type Answer,
  type CloudComputers,
  type Codespace
} from './cloud-computer.js'
import { createCloudTurns } from './cloud-turns.js'

/*
 * THE OTHER AGENTS ON THE CLOUD COMPUTER, SIGNED IN WITH ONE CLICK (0.768). Colin, 2026-10-13, of a sign-in that asked
 * for codes: "making them input launch codes?" Claude Code's and Codex's own sign-ins, run there with no terminal,
 * hand the page they want opened to $BROWSER and wait for its answer on a localhost port there (MEASURED on the test
 * codespace). Locust opens that page in the person's own browser and carries that one port back, so the person
 * clicks Authorize as on this computer, and types nothing.
 *
 * The pages below have the measured shape, with made-up ids: Claude's comes back to a port it picks, Codex's to 1455.
 */
const CLAUDE_PAGE = 'https://claude.com/cai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A42233%2Fcallback&scope=user%3Ainference&code_challenge=X&code_challenge_method=S256&state=X'
const CODEX_PAGE = 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_example&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&code_challenge=X&code_challenge_method=S256&state=X&scope=openid+profile'
const NAME = 'locust-hearth-x7q9'

describe("an agent's sign-in page there", () => {
  it('is opened only when it is that agent\'s own, coming back to a port on localhost', () => {
    expect(signInPage('claude', CLAUDE_PAGE)).toEqual({ url: CLAUDE_PAGE, port: 42233 })
    expect(signInPage('codex', `  ${CODEX_PAGE}\n`)).toEqual({ url: CODEX_PAGE, port: 1455 })
  })

  it('is never opened from another host, over plain http, with a name in it, or for another agent', () => {
    const back = 'redirect_uri=http%3A%2F%2Flocalhost%3A42233%2Fcallback'
    for (const page of [
      `https://evil.example/cai/oauth/authorize?${back}`,
      `https://claude.com.evil.example/cai/oauth/authorize?${back}`,
      `http://claude.com/cai/oauth/authorize?${back}`,
      `https://someone:secret@claude.com/cai/oauth/authorize?${back}`, // A made-up name and password in the address. public-guard: allow
      CODEX_PAGE,
      'not a page at all'
    ]) expect(signInPage('claude', page), page).toBeUndefined()
  })

  it('is never opened when its answer goes anywhere but a port here: not to a web page, another host or a low port', () => {
    for (const back of [
      // Claude's paste-a-code page: the way that asks the person to copy a code, never taken.
      'https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback',
      'http%3A%2F%2Fevil.example%3A42233%2Fcallback',
      'http%3A%2F%2Flocalhost%3A80%2Fcallback',
      'http%3A%2F%2Flocalhost%2Fcallback'
    ]) expect(signInPage('claude', `https://claude.com/cai/oauth/authorize?redirect_uri=${back}`), back).toBeUndefined()
    expect(signInPage('claude', 'https://claude.com/cai/oauth/authorize?code=true')).toBeUndefined()
  })
})

describe('the sign-in run there', () => {
  /** The real script, in a real bash, with a stand-in agent that asks to open its page and then says it is done. */
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash'
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'locust-sign-in-'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it.skipIf(!existsSync(bash))('relays the page the agent opens, its last words and its end, and gives it no terminal or input', async () => {
    await mkdir(join(home, '.locust', 'npm', 'bin'), { recursive: true })
    const agent = join(home, '.locust', 'npm', 'bin', 'claude')
    await writeFile(agent, [
      '#!/bin/sh',
      // What it was asked, and what it was given to read: nothing.
      'echo "asked: $*" > "$HOME/asked"',
      'if [ -t 0 ]; then echo "input: a terminal" >> "$HOME/asked"; else echo "input: $(cat)" >> "$HOME/asked"; fi',
      `"$BROWSER" '${CLAUDE_PAGE}'`,
      'echo "Opening browser to sign in..."',
      'echo "Login successful."',
      ''
    ].join('\n'), { mode: 0o755 })
    const ran = spawnSync(bash, ['-c', signInScript('claude')], { env: { ...process.env, HOME: home.replace(/\\/g, '/') }, encoding: 'utf8', timeout: 30_000 })
    const lines = ran.stdout.split(/\r?\n/).filter((line) => line.length > 0)
    expect(lines.filter((line) => line.startsWith('LOCUST_OPEN '))).toEqual([`LOCUST_OPEN ${CLAUDE_PAGE}`])
    expect(lines).toContain('LOCUST_SAID Login successful.')
    expect(lines.at(-1)).toBe('LOCUST_DONE 0')
    const asked = await readFile(join(home, 'asked'), 'utf8')
    expect(asked).toContain('asked: auth login')
    expect(asked).toContain('input: \n')
  }, 30_000)

  it("goes as base64 on its command line, so none of it is a word a shell there reads", () => {
    const line = scriptLine(signInScript('codex'))
    expect(line).toMatch(/^bash -c "\$\(printf %s [A-Za-z0-9+/=]+ \| base64 -d\)"$/)
    expect(Buffer.from(/printf %s (\S+)/.exec(line)![1]!, 'base64').toString('utf8')).toContain('timeout 900 ~/.locust/npm/bin/codex login')
  })

  it('installs the agent at the version here, and says the home it is under', () => {
    const line = agentInstallLine('claude', '2.1.296')
    expect(line).toContain('npm i -g --prefix ~/.locust/npm @anthropic-ai/claude-code@2.1.296')
    expect(line.endsWith('echo "LOCUST_HOME=$HOME"')).toBe(true)
    expect(() => agentInstallLine('codex', '0.162.1; rm -rf ~')).toThrow()
    // A runner here starts nothing by a path that is not whole, and nothing a shell would read twice.
    expect(cloudLaunchOf('claude', '/home/codespace/.locust/npm/bin/claude')).toMatchObject({ executablePath: '/home/codespace/.locust/npm/bin/claude', prefixArgs: [] })
    expect(() => cloudLaunchOf('claude', '~/.locust/npm/bin/claude')).toThrow()
    expect(() => cloudLaunchOf('claude', '/home/a b/claude')).toThrow()
  })
})

/** gh as a long-running process, as the sign-in starts it: what it was started with, what it says, and its end. */
interface Started {
  readonly args: readonly string[]
  readonly say: (text: string) => void
  readonly exit: () => void
  killed: boolean
}

function processes(): { readonly started: Started[]; readonly start: (args: readonly string[]) => AppServerRunProcess } {
  const started: Started[] = []
  return {
    started,
    start: (args) => {
      const heard: ((text: string) => void)[] = []
      const exits: (() => void)[] = []
      let gone = false
      const one: Started = {
        args,
        killed: false,
        say: (text) => heard.forEach((listener) => listener(text)),
        exit: () => {
          if (gone) return
          gone = true
          exits.forEach((listener) => listener())
        }
      }
      started.push(one)
      return {
        write: () => undefined,
        kill: () => {
          one.killed = true
          one.exit()
        },
        onData: (listener) => {
          heard.push(listener)
        },
        onExit: (listener) => {
          exits.push(listener)
        },
        stderrTail: () => ''
      }
    }
  }
}

describe('signing in there', () => {
  it('opens the page here once its answer can come back, and is done when the agent says so', async () => {
    const { started, start } = processes()
    const opened: string[] = []
    let waited = 0
    const computers = createCloudComputers({ start, portFree: async () => true, reaches: async () => true })
    const signing = computers.signIn(NAME, 'claude', { open: (url) => { opened.push(url) }, waiting: () => { waited += 1 } })
    expect(started[0]!.args.slice(0, 5)).toEqual(['codespace', 'ssh', '-c', NAME, '--'])
    // Its lines arrive in pieces, as a pipe gives them.
    started[0]!.say('Opening browser to sign in\nLOCUST_OP')
    started[0]!.say(`EN ${CLAUDE_PAGE}\n`)
    await vi.waitFor(() => expect(opened).toEqual([CLAUDE_PAGE]))
    // The one port its answer comes back to, carried here to there and nothing else.
    expect(started[1]!.args).toEqual(['codespace', 'ssh', '-c', NAME, '--', '-N', '-L', '42233:127.0.0.1:42233'])
    expect(waited).toBe(1)
    // A second page is never opened as well.
    started[0]!.say(`LOCUST_OPEN ${CODEX_PAGE}\nLOCUST_SAID Login successful.\nLOCUST_DONE 0\n`)
    await expect(signing).resolves.toBeUndefined()
    expect(opened).toEqual([CLAUDE_PAGE])
    expect(started[1]!.killed).toBe(true)
  })

  it('opens nothing that is not its sign-in, and says so', async () => {
    const { started, start } = processes()
    const opened: string[] = []
    const signing = createCloudComputers({ start, portFree: async () => true, reaches: async () => true }).signIn(NAME, 'claude', { open: (url) => { opened.push(url) } })
    started[0]!.say('LOCUST_OPEN https://evil.example/login?redirect_uri=http%3A%2F%2Flocalhost%3A42233%2Fcallback\n')
    await expect(signing).rejects.toThrow("not Claude Code's sign-in, so Locust did not open it")
    expect(opened).toEqual([])
    expect(started).toHaveLength(1)
    expect(started[0]!.killed).toBe(true)
  })

  it('says which port is taken here, and opens nothing', async () => {
    const { started, start } = processes()
    const opened: string[] = []
    const signing = createCloudComputers({ start, portFree: async () => false, reaches: async () => true }).signIn(NAME, 'codex', { open: (url) => { opened.push(url) } })
    started[0]!.say(`LOCUST_OPEN ${CODEX_PAGE}\n`)
    await expect(signing).rejects.toThrow('port 1455 on this computer, and something here is using it')
    expect(opened).toEqual([])
    expect(started).toHaveLength(1)
  })

  it('opens nothing when the way back cannot be reached', async () => {
    const { started, start } = processes()
    const opened: string[] = []
    const signing = createCloudComputers({ start, portFree: async () => true, reaches: async () => false }).signIn(NAME, 'claude', { open: (url) => { opened.push(url) } })
    started[0]!.say(`LOCUST_OPEN ${CLAUDE_PAGE}\n`)
    await expect(signing).rejects.toThrow("could not reach Claude Code's sign-in on your cloud computer")
    expect(opened).toEqual([])
    expect(started[1]!.killed).toBe(true)
  })

  it("says the agent's own reason when it ends without signing in -- never a page's address", async () => {
    const { started, start } = processes()
    const signing = createCloudComputers({ start, portFree: async () => true, reaches: async () => true }).signIn(NAME, 'claude', { open: () => undefined })
    started[0]!.say(`LOCUST_SAID If the browser didn't open, visit: ${CLAUDE_PAGE}\nLOCUST_SAID Paste code here if prompted >\nLOCUST_SAID OAuth error: the request was refused.\nLOCUST_SAID \nLOCUST_DONE 1\n`)
    await expect(signing).rejects.toThrow('Claude Code was not signed in: OAuth error: the request was refused.')
  })

  it('ends when it is stopped, and when the connection ends first', async () => {
    const stopped = processes()
    const controller = new AbortController()
    const signing = createCloudComputers({ start: stopped.start, portFree: async () => true, reaches: async () => true }).signIn(NAME, 'codex', { open: () => undefined, signal: controller.signal })
    stopped.started[0]!.say(`LOCUST_OPEN ${CODEX_PAGE}\n`)
    await vi.waitFor(() => expect(stopped.started).toHaveLength(2))
    controller.abort()
    await expect(signing).rejects.toThrow('Signing Codex in was stopped.')
    expect(stopped.started.every((one) => one.killed)).toBe(true)

    const cut = processes()
    const closing = createCloudComputers({ start: cut.start, portFree: async () => true, reaches: async () => true }).signIn(NAME, 'codex', { open: () => undefined })
    cut.started[0]!.exit()
    await expect(closing).rejects.toThrow("Codex's sign-in on your cloud computer ended before it was done")
  })

  it('reads whether an agent is signed in from its own words, and a failed connection as no answer at all', async () => {
    const answers: Answer[] = []
    const computers = createCloudComputers({ gh: async () => answers.shift() ?? { code: 1, stdout: '', stderr: 'no answer' } })
    answers.push({ code: 0, stdout: '{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\nLOCUST_STATUS=0\n', stderr: '' })
    expect(await computers.agentSignedIn(NAME, 'claude')).toBe(true)
    // MEASURED signed out: Claude says so and exits 0; Codex says so and exits 1.
    answers.push({ code: 0, stdout: '{\n  "loggedIn": false,\n  "authMethod": "none"\n}\nLOCUST_STATUS=0\n', stderr: '' })
    expect(await computers.agentSignedIn(NAME, 'claude')).toBe(false)
    answers.push({ code: 0, stdout: 'Not logged in\nLOCUST_STATUS=1\n', stderr: '' })
    expect(await computers.agentSignedIn(NAME, 'codex')).toBe(false)
    answers.push({ code: 0, stdout: 'Logged in using ChatGPT\nLOCUST_STATUS=0\n', stderr: '' })
    expect(await computers.agentSignedIn(NAME, 'codex')).toBe(true)
    // gh's "shell closed: exit status 1" is the connection failing, not the agent saying it is signed out.
    answers.push({ code: 1, stdout: '', stderr: 'shell closed: exit status 1' })
    await expect(computers.agentSignedIn(NAME, 'codex')).rejects.toThrow('did not say whether Codex is signed in')
  })

  it('finds the agent by its whole path there, at the version that answers', async () => {
    const computers = createCloudComputers({ gh: async () => ({ code: 0, stdout: '2.1.296 (Claude Code)\nLOCUST_HOME=/home/codespace\n', stderr: '' }) })
    expect(await computers.ensureAgent(NAME, 'claude', '2.1.296')).toEqual({ version: '2.1.296', bin: '/home/codespace/.locust/npm/bin/claude' })
    const wrong = createCloudComputers({ gh: async () => ({ code: 0, stdout: '2.1.290 (Claude Code)\nLOCUST_HOME=/home/codespace\n', stderr: '' }) })
    await expect(wrong.ensureAgent(NAME, 'claude', '2.1.296')).rejects.toThrow('Claude Code could not be installed on your cloud computer')
  })
})

describe("an agent's sign-in, as the cloud computer keeps it", () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'locust-cloud-agents-'))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })

  const SPACE: Codespace = { name: NAME, displayName: 'locust-hearth', state: 'Shutdown', repository: 'acme/hearth' }
  const turns = (signedIn: { value: boolean }, calls: string[]) => {
    const computers: CloudComputers = {
      find: async () => SPACE,
      list: async () => [SPACE],
      make: async () => NAME,
      whenReady: async () => { calls.push('ready') },
      ensureOpenCode: async (_name, version) => version,
      ensureAgent: async (_name, agent, version) => {
        calls.push(`${agent}@${version}`)
        return { version, bin: `/home/codespace/.locust/npm/bin/${agent}` }
      },
      agentSignedIn: async (_name, agent) => {
        calls.push(`signed-in?${agent}`)
        return signedIn.value
      },
      signIn: async (_name, agent, hooks) => {
        calls.push(`sign-in:${agent}`)
        await hooks.open(CLAUDE_PAGE)
        hooks.waiting?.()
        signedIn.value = true
      },
      signOut: async (_name, agent) => {
        calls.push(`sign-out:${agent}`)
        signedIn.value = false
      },
      bring: async () => 'a'.repeat(40),
      counts: async () => [],
      change: async () => ({ patch: '', files: [] }),
      settle: async () => 'b'.repeat(40),
      discard: async () => undefined,
      carry: async () => undefined,
      pushChange: async () => ({ branch: 'locust/x', into: 'main' }),
      openPullRequest: async () => ({ number: 1, url: 'https://github.com/acme/hearth/pull/1' }),
      pullRequestOpen: async () => true,
      dropBranch: async () => undefined,
      stop: async () => undefined,
      remove: async () => undefined
    }
    return createCloudTurns({ file: join(folder, 'cloud-turns.json'), computers, git: async (args) => (args[0] === 'remote' ? { code: 0, stdout: 'https://github.com/acme/hearth.git\n', stderr: '' } : { code: 1, stdout: '', stderr: '' }) })
  }

  it('wakes the computer, puts the agent on it, and opens its sign-in: each step said, then kept as signed in', async () => {
    const calls: string[] = []
    const steps: CloudSignInStep[] = []
    const opened: string[] = []
    const cloud = turns({ value: false }, calls)
    expect(await cloud.signIn({ name: NAME, agent: 'claude', version: '2.1.296', open: (url) => { opened.push(url) }, step: (step) => steps.push(step) })).toEqual({ ok: true })
    expect(steps).toEqual(['waking', 'installing', 'opening', 'waiting'])
    expect(calls).toEqual(['ready', 'claude@2.1.296', 'signed-in?claude', 'sign-in:claude', 'signed-in?claude'])
    expect(opened).toEqual([CLAUDE_PAGE])
    // Settings says it without waking the computer again.
    const listed = await cloud.computers()
    expect(listed.ok && listed.computers[0]?.agents).toEqual({ claude: 'signed-in' })
  })

  it('does not sign in again an agent that already is, and signs one out', async () => {
    const calls: string[] = []
    const cloud = turns({ value: true }, calls)
    expect(await cloud.signIn({ name: NAME, agent: 'codex', version: '0.162.1', open: () => undefined, step: () => undefined })).toEqual({ ok: true })
    expect(calls).not.toContain('sign-in:codex')
    expect(await cloud.signOut(NAME, 'codex')).toEqual({ ok: true })
    const listed = await cloud.computers()
    expect(listed.ok && listed.computers[0]?.agents).toEqual({ codex: 'signed-out' })
  })

  it('readies a turn of an agent that is signed in there, and hands back one that is not', async () => {
    const say = vi.fn()
    const signedIn = { value: false }
    const cloud = turns(signedIn, [])
    const refused = await cloud.prepare({ missionId: 'mission_a', folder, openCodeVersion: undefined, agent: { runtime: 'claude', version: '2.1.296' }, say })
    expect(refused).toEqual({ ok: false, message: 'Claude Code is not signed in on your cloud computer yet.', signIn: { computer: NAME, repo: 'acme/hearth', agent: 'claude' } })
    signedIn.value = true
    const ready = await cloud.prepare({ missionId: 'mission_b', folder, openCodeVersion: undefined, agent: { runtime: 'claude', version: '2.1.296' }, say })
    expect(ready).toMatchObject({ ok: true, codespace: NAME, bin: '/home/codespace/.locust/npm/bin/claude' })
    expect(ready.ok && ready.spawn).toBeUndefined()
    expect(await cloud.prepare({ missionId: 'mission_c', folder, openCodeVersion: undefined, agent: { runtime: 'codex', version: undefined }, say })).toEqual({
      ok: false,
      message: 'Locust could not tell which Codex is installed here, so it cannot put the same one on your cloud computer.'
    })
  })
})
