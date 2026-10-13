/**
 * YOUR CLOUD COMPUTER (0.761). Colin, 2026-10-12: "see if theres a way that we can assign any teammate to the cloud
 * or vm", then, of the design: "yes you can also try out cloud teammates". Codex and Claude models already have their
 * makers' clouds (cloud-tasks.ts, claude-cloud.ts). Every other teammate works on a GitHub Codespace on the person's
 * own GitHub account -- one for each repository, made the first time Cloud is picked there -- and its turn is an
 * ordinary turn of the conversation: the same OpenCode server Locust runs here (0.677), started there, reached
 * through the ssh connection's own tunnel, so the reply streams on screen as it is written.
 *
 * MEASURED 2026-10-12 on a real codespace (scratchpad cloud-probe, the throwaway locust-cloud-test repository):
 * `create` returned in 3.5 s and the image finished configuring itself about 30 s later; OpenCode 1.18.27 installed
 * in 21 s; this folder's state went over in 5.4 s; a free turn through the tunnel streamed seven growing pieces of
 * its reply and four tool calls in 13.4 s; its change came back in 4.9 s and applied cleanly here, beside the
 * person's own uncommitted edits.
 *
 * NOTHING THE AGENT DOES REACHES GITHUB. A codespace keeps a token that can push to its repository, and hands it
 * only to a LOGIN shell over ssh (/etc/profile.d/codespaces.sh reads .env-secrets when SSH_CONNECTION is set). So
 * Locust's own steps that need GitHub -- fetching, a pull request the person asked for -- run as a login shell, and
 * the agent runs in a plain one with the token's names, the ssh variables that would load it again and git's
 * credential helper all taken away: MEASURED, its `git push` fails even from `bash -l`, and its `gh` is signed out.
 * The change comes home only when the person presses Apply.
 *
 * Every line run there is built from fixed words, paths Locust made, and base64: nothing a person typed is ever in
 * a command line. The prompt reaches the agent through its server, as it does here.
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import * as http from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rm, writeFile } from 'node:fs/promises'

import type { AppServerRunProcess, ExecutableLaunch, RuntimeSpawn, SpawnedRuntimeProcess } from '@teammate/runtime-adapters'

import { CLOUD_AGENT_NAMES, cloudTaskDir, CLOUD_TASK_ROOT, type CloudAgent, type CloudChangeFile } from '../shared/cloud-computer.js'
import { ghCommand } from './github-account.js'

/** GitHub's smallest machine: 2 CPUs, 8 GB. GitHub's free hours are counted twice for it: 60 of the 120. */
export const CLOUD_MACHINE = 'basicLinux32gb'
/** It stops itself after this long with nothing to do; a stopped one uses no hours, only its disk. */
export const CLOUD_IDLE_TIMEOUT = '10m'
/** Deleted after a week stopped, files and all. The repository on GitHub is not touched. */
export const CLOUD_RETENTION = '168h'
/** Where Locust keeps the agents it installs there, out of reach of the image's own node switching. */
export const CLOUD_TOOLS = '~/.locust/npm'
export const CLOUD_OPENCODE = `${CLOUD_TOOLS}/bin/opencode`

/** What a command answered. */
export interface Answer {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface BinaryAnswer {
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: string
}

/** The GitHub CLI, with what to write on its input; how long it may take. */
export type GhRun = (args: readonly string[], options?: { readonly input?: Buffer | string; readonly timeoutMs?: number }) => Promise<Answer>
/** git in a folder, with variables of its own (a scratch index), its output as bytes when it is a bundle. */
export type GitRun = (args: readonly string[], options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }) => Promise<BinaryAnswer>

/** A codespace as `gh codespace list --json` gives it. */
export interface Codespace {
  readonly name: string
  readonly displayName: string
  readonly state: string
  readonly repository: string
  readonly lastUsedAt?: string
}

/**
 * The name Locust gives a repository's cloud computer, so it finds its own again and never takes one the person
 * made. GitHub allows 48 characters.
 */
export function cloudDisplayName(repo: string): string {
  const name = repo.split('/').pop() ?? repo
  return `locust-${name}`.slice(0, 48)
}

/** The repository's own folder on the codespace: GitHub clones it into /workspaces/<name>. */
export function cloudRepoDir(repo: string): string {
  const name = repo.split('/').pop() ?? repo
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`"${name}" is not a repository name Locust can use there`)
  return `/workspaces/${name}`
}

/**
 * One word in a POSIX shell line. Only what Locust itself makes goes through here -- flags, model ids, paths of its
 * own -- so a quote or a control character is refused rather than escaped: there is never a reason for one.
 */
export function shellWord(text: string): string {
  if (/['\u0000-\u001f\u007f]/.test(text)) throw new Error('That cannot be sent to the cloud computer as it is.')
  return `'${text}'`
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/

/** `NAME=$(printf %s <base64> | base64 -d)`: any value, carried as letters and digits. */
export function envAssignment(name: string, value: string): string {
  if (!ENV_NAME.test(name)) throw new Error(`"${name}" is not a variable name`)
  return `${name}=$(printf %s ${Buffer.from(value, 'utf8').toString('base64')} | base64 -d)`
}

/**
 * What the agent's own process is started with: no GitHub token under any of its names, none of the ssh variables
 * that would load one again in a login shell, and git with no credential helper and no prompt.
 */
export const AGENT_GUARD =
  'GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0= ' +
  'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_CODESPACE_TOKEN -u SSH_CONNECTION -u SSH_CLIENT -u SSH_TTY'

/** The agent's command, run in its task folder there with its own variables. */
export function agentLine(options: { readonly dir: string; readonly executable: string; readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> }): string {
  if (!/^[~/][A-Za-z0-9_./-]*$/.test(options.executable)) throw new Error('That is not a program Locust installed there.')
  const assignments = Object.entries(options.env ?? {}).map(([name, value]) => envAssignment(name, value))
  return `cd ${shellWord(options.dir)} && ${[...assignments, AGENT_GUARD, options.executable, ...options.args.map(shellWord)].join(' ')}`
}

/** Locust's own steps, as a login shell: the only kind the codespace gives its GitHub token to. */
export function ownLine(steps: readonly string[]): string {
  return `bash -lc ${shellWord(steps.join(' && '))}`
}

/** How this folder goes over: fetched, checked, and checked out as the task's own copy, beside the repository. */
export function bringSteps(repoDir: string, taskId: string, base: string): readonly string[] {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('That is not a commit Locust made.')
  // Unquoted, as these steps go inside the login shell's own quotes: so held to letters, digits, dots and dashes.
  if (!/^\/workspaces\/[A-Za-z0-9_.-]+$/.test(repoDir)) throw new Error('That is not a repository folder Locust can use there.')
  const bundle = `/tmp/locust-${taskId}.bundle`
  const dir = cloudTaskDir(taskId)
  return [
    `cd ${repoDir}`,
    'git fetch -q origin',
    `mkdir -p ${CLOUD_TASK_ROOT}`,
    `cat > ${bundle}`,
    `git bundle verify -q ${bundle}`,
    `git fetch -q ${bundle} refs/locust/${taskId}:refs/locust/${taskId}`,
    `rm -f ${bundle}`,
    `git worktree add -q --detach ${dir} ${base}`
  ]
}

/** The task's change since `base`, files it added included, as a patch and as counts. */
export function changeLine(taskId: string, base: string, what: 'patch' | 'counts'): string {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('That is not a commit Locust made.')
  const diff = what === 'patch' ? `git diff --binary ${base}` : `git diff --numstat ${base}`
  return `cd ${shellWord(cloudTaskDir(taskId))} && git add -A -N . && ${diff}`
}

/** `git diff --numstat`'s lines; a binary file counts as changed with no lines. */
export function changeFilesOf(numstat: string): readonly CloudChangeFile[] {
  const files: CloudChangeFile[] = []
  for (const line of numstat.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (match === null) continue
    files.push({ path: match[3]!, added: match[1] === '-' ? 0 : Number(match[1]), removed: match[2] === '-' ? 0 : Number(match[2]), ...(match[1] === '-' ? { binary: true } : {}) })
  }
  return files
}

/** OpenCode installed there at `version`, or installed now: the version that answers. */
export function openCodeInstallLine(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('That is not an OpenCode version.')
  return `test "$(${CLOUD_OPENCODE} --version 2>/dev/null)" = ${version} || { mkdir -p ${CLOUD_TOOLS} && npm i -g --prefix ${CLOUD_TOOLS} opencode-ai@${version} > /tmp/locust-opencode-install.log 2>&1; }; ${CLOUD_OPENCODE} --version`
}

/**
 * THE OTHER AGENTS ON IT (0.768). Colin, 2026-10-13: "We 100% want the other agents on the cloud computer", then, of
 * a sign-in that asked for codes: "making them input launch codes?" Claude Code and Codex go there as OpenCode does,
 * into Locust's own folder at the version this computer has, and each is signed in there by the person, once, in
 * their own browser: the same page and the same Authorize as on this computer, and no code.
 *
 * MEASURED 2026-10-13 on the test codespace, with a stand-in browser and nothing signed in: `claude auth login`
 * (2.1.296) and `codex login` (0.162.1), run with no terminal, each hand the page they want opened to $BROWSER and
 * wait for its answer on a port of their own there -- Claude's at http://localhost:<a port it picks>/callback,
 * Codex's at http://127.0.0.1:1455/auth/callback. So the page opens here, and a second ssh connection carries that
 * port back: the browser's answer to localhost reaches the CLI there. Through it, Claude's own server answered from
 * this computer 7 s after its page was seen.
 */
interface CloudAgentFacts {
  readonly name: string
  readonly npm: string
  readonly bin: string
  readonly login: string
  readonly logout: string
  readonly status: string
  /** Its own words for whether it is signed in. MEASURED signed out: Claude's `"loggedIn": false`, Codex's exit 1. */
  readonly signedIn: (answer: Answer) => boolean
  /** Where its sign-in page may be: anything else the computer asks to open is not opened. */
  readonly pages: readonly string[]
}

export const CLOUD_AGENTS: Readonly<Record<CloudAgent, CloudAgentFacts>> = {
  claude: {
    name: CLOUD_AGENT_NAMES.claude,
    npm: '@anthropic-ai/claude-code',
    bin: `${CLOUD_TOOLS}/bin/claude`,
    login: 'auth login',
    logout: 'auth logout',
    status: 'auth status --json',
    signedIn: (answer) => {
      try {
        return answer.code === 0 && (JSON.parse(answer.stdout) as { loggedIn?: unknown }).loggedIn === true
      } catch {
        return false
      }
    },
    pages: ['claude.com', 'claude.ai', 'platform.claude.com', 'console.anthropic.com']
  },
  codex: {
    name: CLOUD_AGENT_NAMES.codex,
    npm: '@openai/codex',
    bin: `${CLOUD_TOOLS}/bin/codex`,
    login: 'login',
    logout: 'logout',
    status: 'login status',
    signedIn: (answer) => answer.code === 0 && /logged in/i.test(`${answer.stdout}\n${answer.stderr}`) && !/not logged in/i.test(`${answer.stdout}\n${answer.stderr}`),
    pages: ['auth.openai.com']
  }
}

/**
 * The agent there, as a launch the command builders take: Locust's own copy of it, by its whole path there (`bin`,
 * as `ensureAgent` found it) -- a runner here starts nothing by a path that is not whole.
 */
export function cloudLaunchOf(agent: CloudAgent, bin: string): ExecutableLaunch {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(bin)) throw new Error(`That is not where Locust put ${CLOUD_AGENTS[agent].name} there.`)
  return { commandName: agent, discoveredPath: bin, executablePath: bin, prefixArgs: [], kind: 'native' }
}

/** The version in an agent's `--version`: "2.1.296 (Claude Code)", "codex-cli 0.162.1". */
export function agentVersionOf(said: string): string | undefined {
  return /(\d+\.\d+\.\d+)/.exec(said.trim().split(/\r?\n/).pop() ?? '')?.[1]
}

/** The agent there at `version`, or installed now: what its `--version` says, then the home it is under there. */
export function agentInstallLine(agent: CloudAgent, version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`That is not a ${CLOUD_AGENTS[agent].name} version.`)
  const { bin, npm } = CLOUD_AGENTS[agent]
  return `test "$(${bin} --version 2>/dev/null | grep -oE '[0-9]+[.][0-9]+[.][0-9]+' | head -n 1)" = ${version} || { mkdir -p ${CLOUD_TOOLS} && npm i -g --prefix ${CLOUD_TOOLS} ${npm}@${version} > /tmp/locust-${agent}-install.log 2>&1; }; ${bin} --version; echo "LOCUST_HOME=$HOME"`
}

/**
 * The agent's own sign-in, there, with a stand-in for the browser: each page it asks to open comes back as a
 * `LOCUST_OPEN <page>` line, its last words as `LOCUST_SAID`, and its end as `LOCUST_DONE <exit code>`. Nothing here
 * reads or writes what it signs in with; the agent keeps that where it always does. Given it no terminal and no
 * input: the paste-a-code way it also offers is never taken.
 */
export function signInScript(agent: CloudAgent): string {
  const { bin, login } = CLOUD_AGENTS[agent]
  return [
    'set -u',
    'O=$(mktemp -d)',
    'D="$HOME/.locust/open"',
    'mkdir -p "$D"',
    `printf '%s\\n' '#!/bin/sh' 'f="$LOCUST_OPENED/$(date +%s%N).url"' 'printf "%s\\n" "$1" > "$f.tmp" && mv "$f.tmp" "$f"' > "$D/open"`,
    'chmod +x "$D/open"',
    'ln -sf "$D/open" "$D/xdg-open"',
    `LOCUST_OPENED="$O" PATH="$D:$PATH" BROWSER="$D/open" timeout 900 ${bin} ${login} > "$O/said" 2>&1 < /dev/null &`,
    'pid=$!',
    `relay() { for f in "$O"/*.url; do [ -e "$f" ] || continue; printf 'LOCUST_OPEN %s\\n' "$(head -c 4000 "$f" | tr -d '\\r\\n')"; rm -f "$f"; done; }`,
    'while kill -0 "$pid" 2>/dev/null; do relay; sleep 0.2; done',
    'wait "$pid"; code=$?',
    'relay',
    `tail -n 5 "$O/said" | tr -d '\\r' | sed 's/^/LOCUST_SAID /'`,
    'rm -rf "$O"',
    'echo "LOCUST_DONE $code"'
  ].join('\n')
}

/** A script there, carried as base64 on its command line: no input is needed, and nothing in it is a word to parse. */
export function scriptLine(script: string): string {
  return `bash -c "$(printf %s ${Buffer.from(script, 'utf8').toString('base64')} | base64 -d)"`
}

/**
 * The page a sign-in there asked to open, if it is that agent's own: https, on its maker's host, coming back to a
 * port on localhost -- the one port that is then carried here. Anything else is never opened: a computer an agent
 * has worked on is not trusted to choose what opens in the person's browser.
 */
export function signInPage(agent: CloudAgent, text: string): { readonly url: string; readonly port: number } | undefined {
  const raw = text.trim()
  let page: URL
  let back: URL
  try {
    page = new URL(raw)
    back = new URL(page.searchParams.get('redirect_uri') ?? '')
  } catch {
    return undefined
  }
  if (page.protocol !== 'https:' || page.username !== '' || page.password !== '' || !CLOUD_AGENTS[agent].pages.includes(page.hostname)) return undefined
  if (back.protocol !== 'http:' || (back.hostname !== 'localhost' && back.hostname !== '127.0.0.1')) return undefined
  const port = Number(back.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined
  return { url: raw, port }
}

/** What a sign-in there is told along the way. */
export interface SignInHooks {
  /** Opens the agent's page in the person's browser (this computer's own). */
  readonly open: (url: string) => Promise<void> | void
  /** The page is open: the rest is the person's, there. */
  readonly waiting?: () => void
  readonly signal?: AbortSignal
}

/** Free on this computer: a sign-in's answer comes back to the same port number here. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const server = createServer()
    server.once('error', () => resolveFree(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolveFree(true)))
  })
}

/** Whether the agent's own server there answers on this port here yet: any answer at all is the way through. */
export async function reaches(port: number, withinMs: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<boolean> {
  const until = Date.now() + withinMs
  for (;;) {
    const answered = await new Promise<boolean>((resolveAnswer) => {
      const asked = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2_000 }, (response) => {
        response.resume()
        resolveAnswer(true)
      })
      asked.on('timeout', () => asked.destroy())
      asked.on('error', () => resolveAnswer(false))
      asked.end()
    })
    if (answered) return true
    if (Date.now() > until) return false
    await sleep(400)
  }
}

/** A turn of Claude Code there (0.768): the runner's process is gh's ssh, and the agent's input and output are its own. */
export function cloudProcessSpawn(options: { readonly codespace: string; readonly dir: string }): RuntimeSpawn {
  return (executablePath, args) => {
    const line = agentLine({ dir: options.dir, executable: executablePath, args })
    return spawn(ghCommand(), ['codespace', 'ssh', '-c', options.codespace, '--', line], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
    }) as unknown as SpawnedRuntimeProcess
  }
}

/** Codex's app server there (0.768): it speaks its protocol over the ssh connection's own input and output. */
export function cloudAppServerSpawn(options: { readonly codespace: string; readonly dir: string; readonly start?: (args: readonly string[]) => AppServerRunProcess }): (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>) => AppServerRunProcess {
  return (executablePath, args) => (options.start ?? startGh)(['codespace', 'ssh', '-c', options.codespace, '--', agentLine({ dir: options.dir, executable: executablePath, args })])
}

/** A path for a script there: single-quoted, a quote inside closed and reopened. Control characters are refused. */
function scriptWord(text: string): string {
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error('That cannot be sent to the cloud computer as it is.')
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Under `.locust/attachments` and nowhere else -- what a message's files are copied to (shared/attachments.ts) -- with no step back out. */
export function carriedPath(path: string): boolean {
  const prefix = '.locust/attachments/'
  if (!path.startsWith(prefix) || path.includes('\\')) return false
  return path.slice(prefix.length).split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/**
 * THE FILES A MESSAGE ATTACHED, SENT TO THE COPY THERE (0.762). A picture pasted into the box, a file from outside
 * the folder and a PDF Locust opened all sit in this folder's `.locust/attachments`, which git never sees -- so the
 * copy made from git never had them, and the agent was told to read files that were not there. A script on stdin,
 * each file as base64 between its own markers: no command line ever holds a name the person chose. `.locust/` goes
 * into the repository's own exclude there too, so a file sent this way is never part of the change brought home.
 */
export function carryScript(files: readonly { readonly path: string; readonly bytes: Buffer }[]): string {
  const lines = [
    'set -e',
    'common=$(git rev-parse --git-common-dir)',
    'mkdir -p "$common/info"',
    'grep -qxF .locust/ "$common/info/exclude" 2>/dev/null || echo .locust/ >> "$common/info/exclude"'
  ]
  for (const file of files) {
    if (!carriedPath(file.path)) throw new Error('That is not a file Locust attached.')
    const folder = file.path.slice(0, file.path.lastIndexOf('/'))
    const base64 = file.bytes.toString('base64').replace(/.{1,76}/g, (line) => `${line}\n`)
    lines.push(`mkdir -p ${scriptWord(folder)}`, `base64 -d > ${scriptWord(file.path)} <<'LOCUST_FILE'`, `${base64}LOCUST_FILE`)
  }
  lines.push('echo LOCUST_CARRIED')
  return `${lines.join('\n')}\n`
}

/** The most a message's files may come to, sent over in one go. */
export const MAX_CARRY_BYTES = 50 * 1024 * 1024

/** A branch name Locust passes along: letters, digits and `._/-`, not starting with a dash. */
export const SAFE_BRANCH_NAME = /^(?!-)[A-Za-z0-9._/-]{1,200}$/

/** Where a change goes for a pull request: a new branch from GitHub's copy of `from`, or the branch of one already open. */
export type PullRequestTarget =
  | { readonly kind: 'new'; readonly from: string | undefined; readonly wanted: string }
  | { readonly kind: 'add'; readonly branch: string }

/**
 * THE CHANGE, AS A BRANCH ON GITHUB (0.762). Only the change waiting there -- nothing else of this folder's -- put on
 * GitHub's own copy of the branch in a scratch copy beside the task's, committed as the person (the codespace's git
 * is set up with their GitHub name: MEASURED 2026-10-12) and pushed by Locust's login shell, the only one that holds
 * the token. The agent never takes part. A change that will not go onto GitHub's copy -- it leans on edits only this
 * folder has -- fails `git apply`, and nothing is pushed. The message comes on stdin; the branch pushed and the
 * branch it is for are said on the last lines.
 */
export function pullRequestSteps(repoDir: string, taskId: string, base: string, target: PullRequestTarget): readonly string[] {
  if (!/^[0-9a-f]{40}$/.test(base)) throw new Error('That is not a commit Locust made.')
  if (!/^\/workspaces\/[A-Za-z0-9_.-]+$/.test(repoDir)) throw new Error('That is not a repository folder Locust can use there.')
  const names = target.kind === 'new' ? [target.wanted, ...(target.from === undefined ? [] : [target.from])] : [target.branch]
  for (const name of names) if (!SAFE_BRANCH_NAME.test(name)) throw new Error('That is not a branch name Locust will pass to git.')
  const dir = cloudTaskDir(taskId)
  const scratch = `${dir}-pr`
  const patch = `/tmp/locust-${taskId}.patch`
  const message = `/tmp/locust-${taskId}.message`
  const pick = target.kind === 'new'
    ? [
        // The folder's own branch when GitHub has it, else the repository's default.
        `into=${target.from ?? ''}`,
        '{ { test -n "$into" && git ls-remote --exit-code -q --heads origin "$into" > /dev/null; } || into=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed s@^origin/@@); }',
        'git fetch -q origin "$into"',
        `git worktree add -q --detach ${scratch} "origin/$into"`,
        `b=${target.wanted}`,
        'n=1',
        `while git ls-remote --exit-code -q --heads origin "$b" > /dev/null; do n=$((n+1)); b=${target.wanted}-$n; done`
      ]
    : [
        `into=${target.branch}`,
        'git fetch -q origin "$into"',
        `git worktree add -q --detach ${scratch} "origin/$into"`,
        'b="$into"'
      ]
  return [
    `cat > ${message}`,
    `cd ${dir}`,
    'git add -A -N .',
    `git diff --binary ${base} > ${patch}`,
    `test -s ${patch}`,
    `cd ${repoDir}`,
    `rm -rf ${scratch}`,
    'git worktree prune',
    ...pick,
    `cd ${scratch}`,
    `git apply --3way --binary ${patch}`,
    'git add -A',
    `git commit -q -F ${message}`,
    'git push -q origin "HEAD:refs/heads/$b"',
    `cd ${repoDir}`,
    `git worktree remove --force ${scratch}`,
    `rm -f ${patch} ${message}`,
    'echo "LOCUST_BRANCH=$b"',
    'echo "LOCUST_INTO=$into"'
  ]
}

/** GitHub's answer when its sign-in on this computer may not make codespaces. */
export function needsCodespacePermission(said: string): boolean {
  return /codespace.{0,40}scope|scope.{0,40}codespace|must have.{0,40}codespace|admin:org|HTTP 403/i.test(said)
}

/** A port free on this computer, for the tunnel to the server there. */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolvePort(port) : reject(new Error('No port was free.'))))
    })
  })
}

/**
 * The spawn an OpenCode server run is given for a turn there (startOpenCodeServeRun): `opencode serve` on the
 * codespace, on a port free here, with the ssh connection forwarding that port -- so the run's own client, which
 * reads "listening on http://127.0.0.1:<port>" and talks to it, is talking to the server there.
 */
export function cloudServeSpawn(options: {
  readonly codespace: string
  readonly dir: string
  readonly port: number
  readonly start?: (args: readonly string[]) => AppServerRunProcess
}): (executablePath: string, args: readonly string[], env?: Readonly<Record<string, string>>, cwd?: string) => AppServerRunProcess {
  return (_executablePath, args, env) => {
    const remoteArgs = [...args]
    const at = remoteArgs.indexOf('--port')
    if (at === -1 || remoteArgs[at + 1] === undefined) throw new Error('The OpenCode server was not given a port.')
    remoteArgs[at + 1] = String(options.port)
    const line = agentLine({ dir: options.dir, executable: CLOUD_OPENCODE, args: remoteArgs, ...(env === undefined ? {} : { env }) })
    const ghArgs = ['codespace', 'ssh', '-c', options.codespace, '--', '-L', `${String(options.port)}:127.0.0.1:${String(options.port)}`, line]
    return (options.start ?? startGh)(ghArgs)
  }
}

/** gh as a long-running process the server run reads, as it reads OpenCode's own here. */
function startGh(args: readonly string[]): AppServerRunProcess {
  const child = spawn(ghCommand(), [...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' } })
  let tail = ''
  child.stderr.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-4000)
  })
  child.on('error', () => undefined)
  return {
    write: (text) => {
      child.stdin.write(text)
    },
    kill: () => {
      if (child.exitCode === null) child.kill()
    },
    onData: (listener) => {
      child.stdout.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')))
    },
    onExit: (listener) => {
      child.once('close', () => listener())
    },
    stderrTail: () => tail.trim()
  }
}

/** The GitHub CLI, run once, quietly. */
export function runGh(args: readonly string[], options: { readonly input?: Buffer | string; readonly timeoutMs?: number } = {}): Promise<Answer> {
  return new Promise((resolveAnswer) => {
    const child = spawn(ghCommand(), [...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let done = false
    const finish = (code: number): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolveAnswer({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(124)
    }, options.timeoutMs ?? 120_000)
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', () => finish(127))
    child.on('close', (code) => finish(code ?? 1))
    child.stdin.on('error', () => undefined)
    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

/** git, run once in a folder. */
export function runGit(args: readonly string[], options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }): Promise<BinaryAnswer> {
  return new Promise((resolveAnswer) => {
    const child = spawn('git', [...args], { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' } })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', () => resolveAnswer({ code: 127, stdout: Buffer.alloc(0), stderr: 'git is not installed here.' }))
    child.on('close', (code) => resolveAnswer({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }))
  })
}

/** Why a step failed, in a sentence: the last line the tool said that is not noise. */
function lastWord(answer: Answer | BinaryAnswer): string {
  const said = `${typeof answer.stdout === 'string' ? answer.stdout : ''}\n${answer.stderr}`
  const line = said.split(/\r?\n/).map((part) => part.trim()).filter((part) => part.length > 0 && !/^shell closed: exit status/i.test(part)).pop()
  return (line ?? 'It did not say why.').slice(0, 300)
}

export class CloudComputerError extends Error {
  constructor(message: string, readonly kind: 'permission' | 'not-on-github' | 'failed' = 'failed') {
    super(message)
  }
}

/** The biggest folder Locust sends over in one go. */
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024

export interface CloudComputers {
  /** Locust's cloud computer for this repository, if there is one. */
  find(repo: string): Promise<Codespace | undefined>
  /** Every cloud computer Locust made, on any repository. */
  list(): Promise<readonly Codespace[]>
  /** Made now, on the repository's branch: its name. */
  make(repo: string, branch: string | undefined): Promise<string>
  /** Answers once the image has finished setting itself up (and is awake: a stopped one starts on the first ssh). */
  whenReady(name: string, timeoutMs?: number): Promise<void>
  /** OpenCode there at this version: the version that answers. */
  ensureOpenCode(name: string, version: string): Promise<string>
  /** Claude Code or Codex there at this version (0.768): the version that answers, and its whole path there. */
  ensureAgent(name: string, agent: CloudAgent, version: string): Promise<{ readonly version: string; readonly bin: string }>
  /** Whether that agent there is signed in, in its own words. */
  agentSignedIn(name: string, agent: CloudAgent): Promise<boolean>
  /** That agent signed in there by the person, in their own browser here (`signInScript`): done once it says so. */
  signIn(name: string, agent: CloudAgent, hooks: SignInHooks): Promise<void>
  /** That agent signed out there. */
  signOut(name: string, agent: CloudAgent): Promise<void>
  /** This folder as it is, into a task folder of its own there: the commit it starts from. */
  bring(name: string, repo: string, folder: string, taskId: string): Promise<string>
  /** Which files the task changed since it began, and by how many lines: one round trip, for the card. */
  counts(name: string, taskId: string, base: string): Promise<readonly CloudChangeFile[]>
  /** What the task changed since it began. */
  change(name: string, taskId: string, base: string): Promise<{ readonly patch: string; readonly files: readonly CloudChangeFile[] }>
  /** The task's change, kept there as its new starting point once it is in this folder, or in a pull request. */
  settle(name: string, taskId: string, went?: 'here' | 'pull-request'): Promise<string>
  /** The task's change, put back to where it began. */
  discard(name: string, taskId: string, base: string): Promise<void>
  /** A message's own files, into the task's copy there (`carryScript`). */
  carry(name: string, taskId: string, files: readonly { readonly path: string; readonly bytes: Buffer }[]): Promise<void>
  /** The task's change pushed as a branch (`pullRequestSteps`): the branch, and the branch it is for. */
  pushChange(name: string, repo: string, taskId: string, base: string, target: PullRequestTarget, message: string): Promise<{ readonly branch: string; readonly into: string }>
  /** A pull request opened on GitHub, from this computer's own GitHub sign-in. */
  openPullRequest(repo: string, request: { readonly head: string; readonly base: string; readonly title: string; readonly body: string }): Promise<{ readonly number: number; readonly url: string }>
  /** Whether that pull request is still open, so a change can be added to it. */
  pullRequestOpen(repo: string, number: number): Promise<boolean>
  /** A branch Locust pushed for a pull request GitHub then refused: taken away again. */
  dropBranch(repo: string, branch: string): Promise<void>
  stop(name: string): Promise<void>
  remove(name: string): Promise<void>
}

/** An agent's last words worth repeating: not its prompt for a code, and never a page's address. */
function lastWords(said: readonly string[]): string | undefined {
  const words = said.filter((line) => line.length > 0 && !/paste code|https?:\/\//i.test(line)).pop()
  return words?.replace(/[.\s]+$/, '').slice(0, 300)
}

/** The longest a sign-in waits for the person to finish in their browser. */
export const SIGN_IN_WAIT_MS = 10 * 60_000

export function createCloudComputers(options: {
  readonly gh?: GhRun
  readonly git?: GitRun
  readonly sleep?: (ms: number) => Promise<void>
  /** gh as a long-running process: a sign-in's relay, and the connection that carries its answer here. */
  readonly start?: (args: readonly string[]) => AppServerRunProcess
  readonly portFree?: (port: number) => Promise<boolean>
  readonly reaches?: (port: number, withinMs: number) => Promise<boolean>
  readonly signInWaitMs?: number
} = {}): CloudComputers {
  const gh = options.gh ?? runGh
  const git = options.git ?? runGit
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const start = options.start ?? startGh
  const isFree = options.portFree ?? portFree
  const through = options.reaches ?? ((port: number, withinMs: number) => reaches(port, withinMs))
  const waitMs = options.signInWaitMs ?? SIGN_IN_WAIT_MS
  const there = (name: string, line: string, input?: Buffer | string, timeoutMs?: number): Promise<Answer> =>
    gh(['codespace', 'ssh', '-c', name, '--', line], { ...(input === undefined ? {} : { input }), ...(timeoutMs === undefined ? {} : { timeoutMs }) })
  const refuse = (answer: Answer, what: string): never => {
    const said = `${answer.stdout}\n${answer.stderr}`
    if (needsCodespacePermission(said)) {
      throw new CloudComputerError('GitHub has not let Locust make codespaces yet. Allow it once in your browser, then send again.', 'permission')
    }
    throw new CloudComputerError(`${what}: ${lastWord(answer)}`)
  }
  /**
   * An agent's own command there, with its exit code said on the last line: gh answers 1 both for a command that
   * ended with 1 and for a connection that failed ("shell closed: exit status 1", MEASURED), and only the first is the
   * agent's answer.
   */
  const agentSays = async (name: string, words: string, what: string): Promise<Answer> => {
    const answer = await there(name, `${words}; echo "LOCUST_STATUS=$?"`, undefined, 60_000)
    const status = /^LOCUST_STATUS=(\d+)\s*$/m.exec(answer.stdout)
    if (answer.code !== 0 || status === null) refuse(answer, what)
    return { code: Number(status![1]), stdout: answer.stdout.slice(0, status!.index), stderr: answer.stderr }
  }
  const ours = (spaces: readonly Codespace[]): readonly Codespace[] => spaces.filter((space) => space.displayName === cloudDisplayName(space.repository))
  const listed = async (repo?: string): Promise<readonly Codespace[]> => {
    const answer = await gh(['codespace', 'list', ...(repo === undefined ? [] : ['--repo', repo]), '--json', 'name,displayName,state,repository,lastUsedAt', '--limit', '100'], { timeoutMs: 30_000 })
    if (answer.code !== 0) refuse(answer, 'GitHub did not list your codespaces')
    const parsed = JSON.parse(answer.stdout.trim().length === 0 ? '[]' : answer.stdout) as unknown
    return Array.isArray(parsed) ? ours(parsed as Codespace[]) : []
  }
  return {
    find: async (repo) => (await listed(repo)).find((space) => space.repository.toLowerCase() === repo.toLowerCase()),
    list: () => listed(),
    make: async (repo, branch) => {
      const answer = await gh([
        'codespace', 'create', '--repo', repo, ...(branch === undefined ? [] : ['--branch', branch]),
        '--machine', CLOUD_MACHINE, '--idle-timeout', CLOUD_IDLE_TIMEOUT, '--retention-period', CLOUD_RETENTION,
        '--display-name', cloudDisplayName(repo), '--default-permissions'
      ], { timeoutMs: 5 * 60_000 })
      const name = answer.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => /^[A-Za-z0-9-]{8,}$/.test(line))
      if (answer.code !== 0 || name === undefined) refuse(answer, 'GitHub did not make the cloud computer')
      return name!
    },
    whenReady: async (name, timeoutMs = 6 * 60_000) => {
      const until = Date.now() + timeoutMs
      for (;;) {
        // The first ssh to a stopped codespace starts it (MEASURED: 98 s); its setup log says when it is done.
        const answer = await there(name, 'tail -n 1 /workspaces/.codespaces/.persistedshare/creation.log 2>/dev/null || true', undefined, 5 * 60_000)
        if (answer.code === 0 && /Finished configuring codespace/i.test(answer.stdout)) return
        if (answer.code !== 0 && needsCodespacePermission(`${answer.stdout}\n${answer.stderr}`)) refuse(answer, 'GitHub refused')
        if (Date.now() > until) throw new CloudComputerError('Your cloud computer did not finish setting itself up. Try again in a minute.')
        await sleep(5_000)
      }
    },
    ensureOpenCode: async (name, version) => {
      const answer = await there(name, openCodeInstallLine(version), undefined, 5 * 60_000)
      const answered = answer.stdout.trim().split(/\r?\n/).pop()?.trim()
      if (answer.code !== 0 || answered !== version) refuse(answer, 'OpenCode could not be installed on your cloud computer')
      return answered!
    },
    ensureAgent: async (name, agent, version) => {
      const answer = await there(name, agentInstallLine(agent, version), undefined, 8 * 60_000)
      const home = /^LOCUST_HOME=(\/[A-Za-z0-9_./-]+)\s*$/m.exec(answer.stdout)
      const answered = home === null ? undefined : agentVersionOf(answer.stdout.slice(0, home.index))
      if (answer.code !== 0 || home === null || answered !== version) refuse(answer, `${CLOUD_AGENTS[agent].name} could not be installed on your cloud computer`)
      return { version: answered!, bin: CLOUD_AGENTS[agent].bin.replace(/^~/, home![1]!.replace(/\/+$/, '')) }
    },
    agentSignedIn: async (name, agent) => {
      const facts = CLOUD_AGENTS[agent]
      return facts.signedIn(await agentSays(name, `${facts.bin} ${facts.status}`, `Your cloud computer did not say whether ${facts.name} is signed in`))
    },
    signOut: async (name, agent) => {
      const facts = CLOUD_AGENTS[agent]
      await agentSays(name, `${facts.bin} ${facts.logout}`, `${facts.name} could not be signed out on your cloud computer`)
    },
    signIn: (name, agent, hooks) => new Promise<void>((resolveSignIn, rejectSignIn) => {
      const who = CLOUD_AGENTS[agent].name
      let forward: AppServerRunProcess | undefined
      let opened = false
      let ended = false
      let pending = ''
      const said: string[] = []
      const end = (error?: CloudComputerError): void => {
        if (ended) return
        ended = true
        clearTimeout(timer)
        hooks.signal?.removeEventListener('abort', stop)
        relay.kill()
        forward?.kill()
        if (error === undefined) resolveSignIn()
        else rejectSignIn(error)
      }
      const stop = (): void => end(new CloudComputerError(`Signing ${who} in was stopped.`))
      const timer = setTimeout(() => end(new CloudComputerError(`${who} was not signed in: the page in your browser was not finished within ${String(Math.round(waitMs / 60_000))} minutes. Try again when you are ready.`)), waitMs)
      const relay = start(['codespace', 'ssh', '-c', name, '--', scriptLine(signInScript(agent))])
      // The port the answer comes back to is the agent's own choice, so it is carried here only once its page says it.
      const openPage = async (text: string): Promise<void> => {
        const page = signInPage(agent, text)
        if (page === undefined) return end(new CloudComputerError(`Your cloud computer asked to open a page that is not ${who}'s sign-in, so Locust did not open it.`))
        if (!(await isFree(page.port))) {
          return end(new CloudComputerError(`${who}'s sign-in comes back to port ${String(page.port)} on this computer, and something here is using it -- perhaps ${who} signing in here. Finish or close that, then try again.`))
        }
        if (ended) return
        forward = start(['codespace', 'ssh', '-c', name, '--', '-N', '-L', `${String(page.port)}:127.0.0.1:${String(page.port)}`])
        forward.onExit(() => end(new CloudComputerError(`The connection for ${who}'s sign-in closed before it was done. Try again.`)))
        if (!(await through(page.port, 30_000))) return end(new CloudComputerError(`Locust could not reach ${who}'s sign-in on your cloud computer from here. Try again.`))
        if (ended) return
        await hooks.open(page.url)
        hooks.waiting?.()
      }
      relay.onData((chunk) => {
        pending += chunk
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('LOCUST_OPEN ')) {
            // Its first page is the sign-in; one opened after it is never opened as well.
            if (opened) continue
            opened = true
            void openPage(line.slice('LOCUST_OPEN '.length)).catch(() => end(new CloudComputerError(`${who}'s sign-in page could not be opened here.`)))
          } else if (line.startsWith('LOCUST_SAID ')) {
            said.push(line.slice('LOCUST_SAID '.length).trim())
          } else if (line.startsWith('LOCUST_DONE ')) {
            const code = line.slice('LOCUST_DONE '.length).trim()
            if (code === '0') end()
            else end(new CloudComputerError(`${who} was not signed in: ${lastWords(said) ?? (code === '124' ? 'it waited too long for the page in your browser' : 'it did not say why')}.`))
          }
        }
      })
      relay.onExit(() => {
        const why = relay.stderrTail?.() ?? ''
        end(needsCodespacePermission(why)
          ? new CloudComputerError('GitHub has not let Locust use your codespaces yet. Allow it once in your browser, then try again.', 'permission')
          : new CloudComputerError(`${who}'s sign-in on your cloud computer ended before it was done${why.length > 0 ? `: ${why.split(/\r?\n/).pop()!.slice(0, 300)}` : '.'}`))
      })
      if (hooks.signal?.aborted === true) stop()
      else hooks.signal?.addEventListener('abort', stop)
    }),
    bring: async (name, repo, folder, taskId) => {
      // The whole folder as one commit -- what is committed, what is not, and files not yet added -- made with a
      // scratch index, so the person's own staging is never touched; a ref of its own only while it is bundled.
      const index = join(tmpdir(), `locust-cloud-${taskId}-${randomBytes(4).toString('hex')}.index`)
      const scratch = { GIT_INDEX_FILE: index }
      const ref = `refs/locust/${taskId}`
      const step = async (args: readonly string[], env?: Readonly<Record<string, string>>): Promise<BinaryAnswer> => {
        const answer = await git(args, { cwd: folder, ...(env === undefined ? {} : { env }) })
        if (answer.code !== 0) throw new CloudComputerError(`This folder could not be sent: ${lastWord(answer)}`)
        return answer
      }
      let base: string
      let bundle: Buffer
      try {
        await step(['read-tree', 'HEAD'], scratch)
        await step(['add', '-A'], scratch)
        const tree = (await step(['write-tree'], scratch)).stdout.toString('utf8').trim()
        base = (await step(['-c', 'user.name=Locust', '-c', 'user.email=cloud@locust.invalid', 'commit-tree', tree, '-p', 'HEAD', '-m', 'This folder as it was when the cloud turn began'])).stdout.toString('utf8').trim()
        await step(['update-ref', ref, base])
        bundle = (await step(['bundle', 'create', '-', ref, '--not', '--remotes=origin'])).stdout
      } finally {
        await git(['update-ref', '-d', ref], { cwd: folder }).catch(() => undefined)
        await rm(index, { force: true }).catch(() => undefined)
      }
      if (bundle.length > MAX_BUNDLE_BYTES) throw new CloudComputerError('This folder is too big to send in one go: more than 100 MB that GitHub does not have yet.')
      const answer = await there(name, ownLine(bringSteps(cloudRepoDir(repo), taskId, base)), bundle, 5 * 60_000)
      if (answer.code !== 0) refuse(answer, 'This folder could not be set up on your cloud computer')
      return base
    },
    counts: async (name, taskId, base) => {
      const counts = await there(name, changeLine(taskId, base, 'counts'), undefined, 2 * 60_000)
      if (counts.code !== 0) refuse(counts, 'The change could not be read')
      return changeFilesOf(counts.stdout)
    },
    change: async (name, taskId, base) => {
      const counts = await there(name, changeLine(taskId, base, 'counts'), undefined, 2 * 60_000)
      if (counts.code !== 0) refuse(counts, 'The change could not be read')
      const patch = await there(name, changeLine(taskId, base, 'patch'), undefined, 2 * 60_000)
      if (patch.code !== 0) refuse(patch, 'The change could not be read')
      return { patch: patch.stdout, files: changeFilesOf(counts.stdout) }
    },
    settle: async (name, taskId, went = 'here') => {
      // The message on stdin, in words: an agent reading the copy's history there reads what this commit is.
      const line = `cd ${shellWord(cloudTaskDir(taskId))} && git add -A && git -c user.name=Locust -c user.email=cloud@locust.invalid commit -q --allow-empty -F - && git rev-parse HEAD`
      const said = went === 'here' ? 'The change so far, applied to the folder on your computer by Locust\n' : 'The change so far, sent to a pull request on GitHub by Locust\n'
      const answer = await there(name, line, said, 60_000)
      const head = answer.stdout.trim().split(/\r?\n/).pop()?.trim() ?? ''
      if (answer.code !== 0 || !/^[0-9a-f]{40}$/.test(head)) refuse(answer, 'Your cloud computer could not mark the change as brought home')
      return head
    },
    discard: async (name, taskId, base) => {
      if (!/^[0-9a-f]{40}$/.test(base)) throw new CloudComputerError('That is not a commit Locust made.')
      const answer = await there(name, `cd ${shellWord(cloudTaskDir(taskId))} && git reset -q --hard ${base} && git clean -q -fd`, undefined, 60_000)
      if (answer.code !== 0) refuse(answer, 'The change could not be put back')
    },
    carry: async (name, taskId, files) => {
      if (files.length === 0) return
      const bytes = files.reduce((sum, file) => sum + file.bytes.length, 0)
      if (bytes > MAX_CARRY_BYTES) throw new CloudComputerError('The files this message attached come to more than 50 MB, too much to send to your cloud computer.')
      // A plain shell, not a login one: nothing here needs GitHub.
      const answer = await there(name, `cd ${shellWord(cloudTaskDir(taskId))} && bash -s`, carryScript(files), 5 * 60_000)
      if (answer.code !== 0 || !answer.stdout.includes('LOCUST_CARRIED')) refuse(answer, 'The files this message attached could not be sent to your cloud computer')
    },
    pushChange: async (name, repo, taskId, base, target, message) => {
      const answer = await there(name, ownLine(pullRequestSteps(cloudRepoDir(repo), taskId, base, target)), message.endsWith('\n') ? message : `${message}\n`, 5 * 60_000)
      const said = (key: string): string | undefined => new RegExp(`^${key}=(.+)$`, 'm').exec(answer.stdout)?.[1]?.trim()
      const branch = said('LOCUST_BRANCH')
      const into = said('LOCUST_INTO')
      if (answer.code !== 0 || branch === undefined || into === undefined || !SAFE_BRANCH_NAME.test(branch) || !SAFE_BRANCH_NAME.test(into)) {
        const why = `${answer.stdout}\n${answer.stderr}`
        // `git apply` refusing is the change leaning on what only this folder has: said as that, not as git's words.
        if (/patch does not apply|patch failed|with conflicts|does not exist in index|already exists in (?:index|working directory)/i.test(why)) {
          throw new CloudComputerError('The change builds on edits in this folder that GitHub does not have, so it cannot go to GitHub on its own. Apply it here instead, then commit and push.')
        }
        refuse(answer, 'The change could not be pushed to GitHub')
      }
      return { branch: branch!, into: into! }
    },
    openPullRequest: async (repo, request) => {
      if (!SAFE_BRANCH_NAME.test(request.head) || !SAFE_BRANCH_NAME.test(request.base)) throw new CloudComputerError('That is not a branch name Locust will pass to git.')
      // Each value joined to its flag, so none of them can be read as a flag of its own (folder-commit.ts does the same).
      const answer = await gh(['pr', 'create', '--repo', repo, `--head=${request.head}`, `--base=${request.base}`, `--title=${request.title}`, `--body=${request.body}`], { timeoutMs: 60_000 })
      const url = /https:\/\/\S+\/pull\/(\d+)/.exec(answer.stdout)
      if (answer.code !== 0 || url === null) refuse(answer, 'GitHub did not open the pull request')
      return { number: Number(url![1]), url: url![0] }
    },
    pullRequestOpen: async (repo, number) => {
      const answer = await gh(['pr', 'view', String(number), '--repo', repo, '--json', 'state'], { timeoutMs: 30_000 })
      if (answer.code !== 0) refuse(answer, 'GitHub did not say whether the pull request is open')
      return /"state"\s*:\s*"OPEN"/.test(answer.stdout)
    },
    dropBranch: async (repo, branch) => {
      if (!SAFE_BRANCH_NAME.test(branch) || !branch.startsWith('locust/')) return
      await gh(['api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${branch}`], { timeoutMs: 30_000 }).catch(() => undefined)
    },
    stop: async (name) => {
      const answer = await gh(['codespace', 'stop', '-c', name], { timeoutMs: 2 * 60_000 })
      if (answer.code !== 0) refuse(answer, 'Your cloud computer did not stop')
    },
    remove: async (name) => {
      const answer = await gh(['codespace', 'delete', '-c', name, '--force'], { timeoutMs: 2 * 60_000 })
      if (answer.code !== 0) refuse(answer, 'Your cloud computer was not deleted')
    }
  }
}

/** The patch, written where `git apply` can read it, and gone after. */
export async function applyHere(folder: string, patch: string, git: GitRun = runGit): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  if (patch.trim().length === 0) return { ok: true }
  const file = join(tmpdir(), `locust-cloud-${randomBytes(6).toString('hex')}.patch`)
  await writeFile(file, patch, 'utf8')
  try {
    const check = await git(['apply', '--check', '--binary', file], { cwd: folder })
    if (check.code !== 0) {
      return { ok: false, message: `It no longer fits this folder: ${lastWord(check)}. Show the change to take what you need by hand.` }
    }
    const applied = await git(['apply', '--binary', file], { cwd: folder })
    return applied.code === 0 ? { ok: true } : { ok: false, message: `It could not be applied: ${lastWord(applied)}` }
  } finally {
    await rm(file, { force: true }).catch(() => undefined)
  }
}
