import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

import {
  allowedImageUrl,
  issueBranchName,
  issueBrief,
  issueImageName,
  issueImageUrls,
  parseIssueList,
  parseIssueView,
  startedIssue,
  type ListedIssue,
  type StartedIssue,
  type ViewedIssue
} from '../shared/github-issue.js'

const LIST_FIELDS = 'number,title,author,createdAt,labels,url'
const VIEW_FIELDS = 'title,body,comments,labels,url'
const IMAGE_BYTES = 4_000_000
const HOPS = 3

export interface IssueImage {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface OpenedIssue {
  readonly brief: string
  readonly issue: StartedIssue
  readonly images: readonly IssueImage[]
}

type Get = (url: string, init: { redirect: 'manual'; signal: AbortSignal }) => Promise<{
  readonly status: number
  readonly ok: boolean
  readonly headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
}>

/**
 * The folder's open issues, through the person's own `gh` in that folder.
 * A folder `gh` cannot read is not a list. The window names an issue number, never a folder or a URL to fetch.
 */
export function createGithubIssues(options: {
  readonly folder: () => string | undefined
  readonly gh?: (args: readonly string[], cwd: string) => Promise<string>
  readonly get?: Get
  readonly originsFile?: string
}) {
  const gh = options.gh ?? defaultGh
  const get = options.get ?? defaultGet

  const ready = async (): Promise<boolean> => {
    const folder = options.folder()
    if (folder === undefined) return false
    const named = await gh(['repo', 'view', '--json', 'nameWithOwner'], folder).catch(() => '')
    return /"nameWithOwner"\s*:\s*"[^"]+\/[^"]+"/.test(named)
  }

  const list = async (): Promise<readonly ListedIssue[]> => {
    const folder = options.folder()
    if (folder === undefined || !await ready()) return []
    const text = await gh(['issue', 'list', '--state', 'open', '--limit', '30', '--json', LIST_FIELDS], folder).catch(() => '[]')
    return parseIssueList(text)
  }

  const open = async (number: number): Promise<OpenedIssue | undefined> => {
    const folder = options.folder()
    if (folder === undefined || !Number.isInteger(number) || number < 1) return undefined
    const text = await gh(['issue', 'view', String(number), '--json', VIEW_FIELDS], folder).catch(() => '')
    const issue = parseIssueView(text, number)
    if (issue === undefined) return undefined
    const images = await readIssueImages(issue, get)
    return { brief: issueBrief(issue), issue: { number: issue.number, title: issue.title, url: issue.url }, images }
  }

  const readOrigins = async (): Promise<Record<string, StartedIssue>> => {
    if (options.originsFile === undefined) return {}
    try {
      const parsed: unknown = JSON.parse(await readFile(options.originsFile, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return {}
      const kept: Record<string, StartedIssue> = {}
      for (const [id, value] of Object.entries(parsed)) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) continue
        const issue = startedIssue(value)
        if (issue !== undefined) kept[id] = issue
      }
      return kept
    } catch {
      return {}
    }
  }

  const writeOrigins = async (origins: Record<string, StartedIssue>): Promise<void> => {
    if (options.originsFile === undefined) return
    const ids = Object.keys(origins)
    const trimmed = ids.length <= 2_000 ? origins : Object.fromEntries(ids.slice(-2_000).map((id) => [id, origins[id]!]))
    await writeFile(options.originsFile, JSON.stringify(trimmed), 'utf8')
  }

  return {
    ready,
    list,
    open,
    remembered: async (missionId: string): Promise<StartedIssue | undefined> => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(missionId)) return undefined
      return (await readOrigins())[missionId]
    },
    remember: async (missionId: string, issue: StartedIssue): Promise<void> => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(missionId) || startedIssue(issue) === undefined) return
      const origins = await readOrigins()
      origins[missionId] = issue
      await writeOrigins(origins)
    },
    /** A follow-up keeps the issue the conversation started from. */
    copy: async (fromId: string, toId: string): Promise<void> => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(fromId) || !/^[A-Za-z0-9_-]{1,128}$/.test(toId)) return
      const origins = await readOrigins()
      const issue = origins[fromId]
      if (issue === undefined || origins[toId] !== undefined) return
      origins[toId] = issue
      await writeOrigins(origins)
    }
  }
}

export async function readIssueImages(issue: ViewedIssue, get: Get): Promise<readonly IssueImage[]> {
  const urls = issueImageUrls([issue.body, ...issue.comments.map((comment) => comment.body)])
  const images: IssueImage[] = []
  for (const [index, url] of urls.entries()) {
    const bytes = await readOneImage(url, get)
    if (bytes !== undefined) images.push({ name: issueImageName(issue.number, index, url), bytes })
  }
  return images
}

async function readOneImage(start: string, get: Get): Promise<Uint8Array | undefined> {
  const first = allowedImageUrl(start)
  if (first === undefined) return undefined
  let current: string = first
  for (let hop = 0; hop <= HOPS; hop += 1) {
    let response: Awaited<ReturnType<Get>>
    try {
      response = await get(current, { redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    } catch {
      return undefined
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      const next: string | undefined = location === null ? undefined : allowedImageUrl(new URL(location, current).toString())
      if (next === undefined || hop === HOPS) return undefined
      current = next
      continue
    }
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_BYTES) return undefined
    return bytes
  }
  return undefined
}

function defaultGet(url: string, init: { redirect: 'manual'; signal: AbortSignal }): ReturnType<Get> {
  return fetch(url, init)
}

/** git's own words, for the issue branch. A refusal is a thrown error the caller can ignore. */
export function gitText(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(String(stderr || stdout || error.message)))
      else resolve(String(stdout))
    })
  })
}

function defaultGh(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', [...args], {
      cwd, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
    }, (error, stdout) => { if (error) reject(error); else resolve(String(stdout)) })
  })
}

/**
 * Check out `fix/<n>-<title>` in a teammate's own copy. Already there is left
 * there. A checkout git refuses (other work in the way) changes nothing.
 */
export async function checkoutIssueBranch(
  runGit: (args: readonly string[], cwd: string) => Promise<string>,
  cwd: string,
  number: number,
  title: string
): Promise<string | undefined> {
  const branch = issueBranchName(number, title)
  if (!/^fix\/\d{1,10}(?:-[a-z0-9](?:[a-z0-9._-]{0,38}[a-z0-9])?)?$/.test(branch)) return undefined
  const current = (await runGit(['symbolic-ref', '--short', '-q', 'HEAD'], cwd).catch(() => '')).trim()
  if (current === branch) return branch
  const exists = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd).then(() => true, () => false)
  try {
    await runGit(exists ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch], cwd)
  } catch {
    return undefined
  }
  return branch
}
