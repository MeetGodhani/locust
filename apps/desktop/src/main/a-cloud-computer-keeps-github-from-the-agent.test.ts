import { describe, expect, it } from 'vitest'

import {
  agentLine,
  AGENT_GUARD,
  bringSteps,
  carriedPath,
  carryScript,
  changeFilesOf,
  changeLine,
  cloudDisplayName,
  cloudServeSpawn,
  createCloudComputers,
  envAssignment,
  openCodeInstallLine,
  ownLine,
  pullRequestSteps,
  shellWord,
  type Answer,
  type BinaryAnswer
} from './cloud-computer.js'

/*
 * YOUR CLOUD COMPUTER (0.761). The lines Locust runs on a person's GitHub Codespace are built here from fixed words,
 * paths it made and base64 -- never from anything a person typed -- and the agent's own process runs without the
 * codespace's GitHub token under any of its names, so nothing it does reaches GitHub (MEASURED 2026-10-12: its
 * `git push` failed even from `bash -l`, and its `gh` was signed out). Locust's own steps that need GitHub run as a
 * login shell, the only kind the codespace hands its token to.
 */
describe('the lines run on the cloud computer', () => {
  it("starts the agent in its task folder with GitHub's token and its loaders taken away", () => {
    const line = agentLine({ dir: '/workspaces/.locust/t_ab12cd34', executable: '~/.locust/npm/bin/opencode', args: ['serve', '--port', '4096', '--hostname', '127.0.0.1'], env: { OPENCODE_CONFIG_CONTENT: '{"permission":{"edit":"allow"}}' } })
    expect(line.startsWith("cd '/workspaces/.locust/t_ab12cd34' && ")).toBe(true)
    expect(line).toContain(AGENT_GUARD)
    for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_CODESPACE_TOKEN', 'SSH_CONNECTION']) expect(line).toContain(`-u ${name}`)
    expect(line).toContain('GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= ')
    expect(line).toContain('GIT_TERMINAL_PROMPT=0')
    // The config travels as base64, so its quotes and braces never meet a shell.
    expect(line).toContain(`OPENCODE_CONFIG_CONTENT=$(printf %s ${Buffer.from('{"permission":{"edit":"allow"}}').toString('base64')} | base64 -d)`)
    expect(line).not.toContain('"permission"')
    expect(line.endsWith("~/.locust/npm/bin/opencode 'serve' '--port' '4096' '--hostname' '127.0.0.1'")).toBe(true)
  })

  it('refuses a word with a quote or a control character rather than escaping it', () => {
    expect(() => shellWord("it's")).toThrow()
    expect(() => shellWord('line\nbreak')).toThrow()
    expect(() => envAssignment('not a name', 'x')).toThrow()
    expect(() => agentLine({ dir: '/w', executable: 'rm -rf /', args: [] })).toThrow()
  })

  it("runs Locust's own steps as a login shell, and brings the folder into a copy of its own", () => {
    const base = 'a'.repeat(40)
    const steps = bringSteps('/workspaces/hearth', 't_ab12cd34', base)
    expect(steps).toEqual([
      'cd /workspaces/hearth',
      'git fetch -q origin',
      'mkdir -p /workspaces/.locust',
      'cat > /tmp/locust-t_ab12cd34.bundle',
      'git bundle verify -q /tmp/locust-t_ab12cd34.bundle',
      'git fetch -q /tmp/locust-t_ab12cd34.bundle refs/locust/t_ab12cd34:refs/locust/t_ab12cd34',
      'rm -f /tmp/locust-t_ab12cd34.bundle',
      `git worktree add -q --detach /workspaces/.locust/t_ab12cd34 ${base}`
    ])
    expect(ownLine(['git fetch -q origin', 'echo done'])).toBe("bash -lc 'git fetch -q origin && echo done'")
    expect(() => bringSteps('/workspaces/hearth', 't_ab12cd34', 'HEAD; rm -rf /')).toThrow()
    expect(() => bringSteps('/workspaces/hearth', '../escape', base)).toThrow()
    expect(() => bringSteps("/workspaces/it's", 't_ab12cd34', base)).toThrow()
  })

  it('reads a change with the files it added, and its counts with a binary file as changed', () => {
    const base = 'b'.repeat(40)
    expect(changeLine('t_ab12cd34', base, 'patch')).toBe(`cd '/workspaces/.locust/t_ab12cd34' && git add -A -N . && git diff --binary ${base}`)
    expect(changeFilesOf('12\t4\tsrc/dates.ts\n6\t2\ttests/dates.test.ts\n-\t-\tlogo.png\n')).toEqual([
      { path: 'src/dates.ts', added: 12, removed: 4 },
      { path: 'tests/dates.test.ts', added: 6, removed: 2 },
      { path: 'logo.png', added: 0, removed: 0, binary: true }
    ])
  })

  it('installs only an exact OpenCode version, into a folder of its own', () => {
    expect(openCodeInstallLine('1.18.27')).toContain('npm i -g --prefix ~/.locust/npm opencode-ai@1.18.27')
    expect(() => openCodeInstallLine('latest; curl evil')).toThrow()
  })

  it("starts OpenCode's server there on a port free here, forwarded by the ssh connection itself", () => {
    const started: (readonly string[])[] = []
    const spawn = cloudServeSpawn({
      codespace: 'locust-hearth-abc123xyz',
      dir: '/workspaces/.locust/t_ab12cd34',
      port: 57033,
      start: (args) => {
        started.push(args)
        return { write: () => undefined, kill: () => undefined, onData: () => undefined, onExit: () => undefined }
      }
    })
    spawn('opencode', ['serve', '--port', '0', '--hostname', '127.0.0.1'], { OPENCODE_SERVER_PASSWORD: 'pw' })
    const args = started[0]!
    expect(args.slice(0, 7)).toEqual(['codespace', 'ssh', '-c', 'locust-hearth-abc123xyz', '--', '-L', '57033:127.0.0.1:57033'])
    expect(args[7]).toContain("'serve' '--port' '57033' '--hostname' '127.0.0.1'")
    expect(args[7]).toContain(AGENT_GUARD)
  })
})

describe("the person's cloud computers on GitHub", () => {
  const answer = (stdout: string, code = 0, stderr = ''): Answer => ({ code, stdout, stderr })

  it("finds only the one Locust made for the repository, never one the person made", async () => {
    const computers = createCloudComputers({
      gh: async () => answer(JSON.stringify([
        { name: 'mine-123456789', displayName: 'my own', state: 'Available', repository: 'acme/hearth' },
        { name: 'locust-hearth-abc', displayName: cloudDisplayName('acme/hearth'), state: 'Shutdown', repository: 'acme/hearth' }
      ]))
    })
    expect((await computers.find('acme/hearth'))?.name).toBe('locust-hearth-abc')
  })

  it("says plainly when GitHub has not let Locust make codespaces", async () => {
    const computers = createCloudComputers({ gh: async () => answer('', 1, 'HTTP 403: Must have admin rights to Repository. This API requires the codespace scope.') })
    await expect(computers.find('acme/hearth')).rejects.toMatchObject({ kind: 'permission' })
  })

  it("makes a small one that stops itself and is deleted after a week, named so it is found again", async () => {
    let asked: readonly string[] = []
    const computers = createCloudComputers({
      gh: async (args) => {
        asked = args
        return answer('  ✓ Codespaces usage for this repository is paid for by acme\nlocust-hearth-x7q9r2\n')
      }
    })
    expect(await computers.make('acme/hearth', 'main')).toBe('locust-hearth-x7q9r2')
    expect(asked).toEqual([
      'codespace', 'create', '--repo', 'acme/hearth', '--branch', 'main', '--machine', 'basicLinux32gb',
      '--idle-timeout', '10m', '--retention-period', '168h', '--display-name', 'locust-hearth', '--default-permissions'
    ])
  })

  it("sends this folder as one commit made with a scratch index, so the person's own staging is untouched", async () => {
    const gitCalls: { readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> }[] = []
    const base = 'c'.repeat(40)
    const git = async (args: readonly string[], options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }): Promise<BinaryAnswer> => {
      gitCalls.push({ args, ...(options.env === undefined ? {} : { env: options.env }) })
      const out = args[0] === 'write-tree' ? 'd'.repeat(40) : args.includes('commit-tree') ? base : args[0] === 'bundle' ? 'BUNDLE-BYTES' : ''
      return { code: 0, stdout: Buffer.from(out), stderr: '' }
    }
    let sentInput: Buffer | string | undefined
    let sentLine = ''
    const computers = createCloudComputers({
      git,
      gh: async (args, options) => {
        sentLine = args[args.length - 1]!
        sentInput = options?.input
        return answer('')
      }
    })
    expect(await computers.bring('locust-hearth-abc', 'acme/hearth', 'C:\\work\\hearth', 't_ab12cd34')).toBe(base)
    const scratch = gitCalls.filter((call) => call.env?.GIT_INDEX_FILE !== undefined).map((call) => call.args[0])
    expect(scratch).toEqual(['read-tree', 'add', 'write-tree'])
    expect(gitCalls.find((call) => call.args[0] === 'bundle')?.args).toEqual(['bundle', 'create', '-', 'refs/locust/t_ab12cd34', '--not', '--remotes=origin'])
    // The temporary ref is taken away again.
    expect(gitCalls.some((call) => call.args[0] === 'update-ref' && call.args[1] === '-d')).toBe(true)
    expect(sentInput?.toString()).toBe('BUNDLE-BYTES')
    expect(sentLine.startsWith("bash -lc 'cd ")).toBe(true)
  })
})

/*
 * 0.762: the files a message attached, and a pull request from the change. Both are built like everything else
 * sent there -- fixed words, paths Locust made, the person's words only on stdin -- and the pull request is pushed by
 * Locust's login shell, never by the agent (MEASURED 2026-10-12: the codespace's git commits as the person's GitHub
 * name, its token pushes a branch, and this computer's gh opens the pull request).
 */
describe("a message's files and a pull request, from the cloud computer", () => {
  const answer = (stdout: string, code = 0, stderr = ''): Answer => ({ code, stdout, stderr })

  it('sends only files under .locust/attachments, never a step back out of it', () => {
    expect(carriedPath('.locust/attachments/shot.png')).toBe(true)
    expect(carriedPath('.locust/attachments/spec/page-1.png')).toBe(true)
    expect(carriedPath('src/app.ts')).toBe(false)
    expect(carriedPath('.locust/attachments/../../.ssh/id_ed25519')).toBe(false)
    expect(carriedPath('.locust/attachments/..')).toBe(false)
    expect(carriedPath('.locust/attachments\\..\\x')).toBe(false)
  })

  it("writes each file from base64 between its own markers, its name quoted, and keeps .locust/ out of the change", () => {
    const script = carryScript([
      { path: ".locust/attachments/Colin's shot.png", bytes: Buffer.from([137, 80, 78, 71, 13, 10]) },
      { path: '.locust/attachments/spec/page-1.png', bytes: Buffer.alloc(0) }
    ])
    expect(script).toContain('grep -qxF .locust/ "$common/info/exclude" 2>/dev/null || echo .locust/ >> "$common/info/exclude"')
    expect(script).toContain(`base64 -d > '.locust/attachments/Colin'\\''s shot.png' <<'LOCUST_FILE'\n${Buffer.from([137, 80, 78, 71, 13, 10]).toString('base64')}\nLOCUST_FILE\n`)
    expect(script).toContain("mkdir -p '.locust/attachments/spec'")
    expect(script).toContain("base64 -d > '.locust/attachments/spec/page-1.png' <<'LOCUST_FILE'\nLOCUST_FILE\n")
    expect(script.trimEnd().endsWith('echo LOCUST_CARRIED')).toBe(true)
    expect(() => carryScript([{ path: 'src/app.ts', bytes: Buffer.from('x') }])).toThrow()
    expect(() => carryScript([{ path: '.locust/attachments/a\nb', bytes: Buffer.from('x') }])).toThrow()
  })

  it('sends them over a plain shell, not a login one: nothing there needs GitHub', async () => {
    let line = ''
    let input: Buffer | string | undefined
    const computers = createCloudComputers({
      gh: async (args, options) => {
        line = args[args.length - 1]!
        input = options?.input
        return answer('LOCUST_CARRIED\n')
      }
    })
    await computers.carry('locust-hearth-abc', 't_ab12cd34', [{ path: '.locust/attachments/shot.png', bytes: Buffer.from('png') }])
    expect(line).toBe("cd '/workspaces/.locust/t_ab12cd34' && bash -s")
    expect(String(input)).toContain(".locust/attachments/shot.png")
  })

  it('pushes only the change, onto GitHub\'s copy of the branch, from a scratch copy beside the task', () => {
    const steps = pullRequestSteps('/workspaces/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'new', from: 'main', wanted: 'locust/add-a-greeting' })
    const line = ownLine(steps)
    expect(line.startsWith("bash -lc '")).toBe(true)
    expect(steps[0]).toBe('cat > /tmp/locust-t_ab12cd34.message')
    expect(steps).toContain(`git diff --binary ${'c'.repeat(40)} > /tmp/locust-t_ab12cd34.patch`)
    expect(steps).toContain('git worktree add -q --detach /workspaces/.locust/t_ab12cd34-pr "origin/$into"')
    expect(steps).toContain('git apply --3way --binary /tmp/locust-t_ab12cd34.patch')
    expect(steps).toContain('git commit -q -F /tmp/locust-t_ab12cd34.message')
    expect(steps).toContain('git push -q origin "HEAD:refs/heads/$b"')
    // A name already on GitHub gets a number, rather than a push onto someone's branch.
    expect(steps.some((step) => step.startsWith('while git ls-remote --exit-code -q --heads origin "$b"'))).toBe(true)
    // Never the agent's line: no guard, so the login shell's token is what pushes.
    expect(line).not.toContain('env -u GITHUB_TOKEN')
  })

  it('adds to an open one on its own branch', () => {
    const steps = pullRequestSteps('/workspaces/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'add', branch: 'locust/add-a-greeting' })
    expect(steps).toContain('into=locust/add-a-greeting')
    expect(steps).toContain('b="$into"')
    expect(steps.some((step) => step.startsWith('while '))).toBe(false)
  })

  it('refuses a branch name a shell could read as more than a name', () => {
    expect(() => pullRequestSteps('/workspaces/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'add', branch: 'x; rm -rf ~' })).toThrow()
    expect(() => pullRequestSteps('/workspaces/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'new', from: '$(id)', wanted: 'locust/x' })).toThrow()
    expect(() => pullRequestSteps('/workspaces/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'add', branch: '-delete' })).toThrow()
  })

  it("says a change that leans on this folder's own edits in words, not git's", async () => {
    const computers = createCloudComputers({ gh: async () => ({ code: 1, stdout: '', stderr: 'error: patch failed: greeting.txt:1\nerror: greeting.txt: patch does not apply\n' }) })
    await expect(computers.pushChange('locust-hearth-abc', 'acme/hearth', 't_ab12cd34', 'c'.repeat(40), { kind: 'new', from: 'main', wanted: 'locust/x' }, 'Add it')).rejects.toThrow(/builds on edits in this folder that GitHub does not have/)
  })

  it('opens the pull request from this computer, each value joined to its flag', async () => {
    let sent: readonly string[] = []
    const computers = createCloudComputers({
      gh: async (args) => {
        sent = args
        return answer('https://github.com/acme/hearth/pull/12\n')
      }
    })
    expect(await computers.openPullRequest('acme/hearth', { head: 'locust/x', base: 'main', title: '--draft', body: 'Body' })).toEqual({ number: 12, url: 'https://github.com/acme/hearth/pull/12' })
    expect(sent).toEqual(['pr', 'create', '--repo', 'acme/hearth', '--head=locust/x', '--base=main', '--title=--draft', '--body=Body'])
  })
})
