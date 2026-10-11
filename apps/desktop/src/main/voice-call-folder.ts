import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { mcpText, type McpToolResult } from './locust-mcp-host.js'
import { listWorkspaceFiles, type WorkspaceFiles } from './workspace-files.js'

/*
 * A VOICE CALL READS THE FOLDER WITH LOCUST'S OWN TOOLS (0.742).
 *
 * Colin, 2026-10-11, in a call: "local reads failed with approval request, no approval field in locust". The call's
 * Codex reads by running commands, and a command asks first: Locust refused every one, and on his machine Codex's
 * sandbox could not start a command anyway ("setup refresh had errors", measured the same day). So the call reads
 * with three tools of Locust's own instead: they never run anything, they never leave the folder, and they say
 * they are read only, so Codex runs them without asking (measured: a tool marked readOnlyHint ran with no
 * approval request; one without asked).
 */
export const CALL_FOLDER_TOOLS: ReadonlySet<string> = new Set(['find_files', 'read_file', 'search_files'])

const MAX_PATHS = 200
const MAX_READ_BYTES = 256 * 1024
const LINES_PER_READ = 400
const MAX_SEARCHED_FILES = 3_000
const MAX_SEARCHED_BYTES = 1024 * 1024
const MAX_MATCHES = 60
/** What a person keeps secrets in: never read aloud, whatever the folder holds. */
const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519|ecdsa|dsa)|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?|secrets?\.(json|ya?ml|toml))$/i

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined)

export function callFolderTools(folder: () => string | undefined, list: (root: string) => Promise<WorkspaceFiles> = listWorkspaceFiles) {
  /** The file, as the folder's own path, if it really is inside the folder (links followed). */
  async function inside(root: string, asked: string): Promise<{ readonly full: string; readonly shown: string } | string> {
    if (isAbsolute(asked) || /^[A-Za-z]:/.test(asked)) return 'Give the path inside the folder, like src/app.ts.'
    if (SECRET.test(asked.replace(/\\/g, '/'))) return 'That file holds secrets, so a call never reads it.'
    let realRoot: string
    let full: string
    try {
      realRoot = await realpath(root)
      full = await realpath(resolve(root, asked))
    } catch {
      return `There is no ${asked} in the folder.`
    }
    const shown = relative(realRoot, full)
    if (shown.length === 0 || shown.startsWith('..') || isAbsolute(shown)) return 'That is outside the folder, so a call does not read it.'
    if (SECRET.test(shown.split(sep).join('/'))) return 'That file holds secrets, so a call never reads it.'
    return { full, shown: shown.split(sep).join('/') }
  }

  /** The start of a file, or undefined when it is not text a person would read. */
  async function head(full: string, limit: number): Promise<string | undefined> {
    const handle = await open(full, 'r')
    try {
      const buffer = Buffer.alloc(limit)
      const { bytesRead } = await handle.read(buffer, 0, limit, 0)
      const bytes = buffer.subarray(0, bytesRead)
      if (bytes.subarray(0, 8192).includes(0)) return undefined
      return bytes.toString('utf8')
    } finally {
      await handle.close()
    }
  }

  return async (name: string, given: unknown): Promise<McpToolResult> => {
    const args: Record<string, unknown> = typeof given === 'object' && given !== null && !Array.isArray(given) ? given as Record<string, unknown> : {}
    const root = folder()
    if (root === undefined) return mcpText('No folder is open in Locust.', true)
    if (name === 'find_files') {
      const { paths, truncated } = await list(root)
      const kept = paths.filter((path) => !SECRET.test(path))
      const query = text(args.query)?.toLowerCase()
      const found = query === undefined ? kept : kept.filter((path) => path.toLowerCase().includes(query))
      if (found.length === 0) return mcpText(query === undefined ? 'The folder has no files.' : `No file's path has "${query}" in it.`)
      const shown = found.slice(0, MAX_PATHS)
      const more = found.length > shown.length || truncated ? `\n(The first ${String(shown.length)} of ${truncated ? 'more than ' : ''}${String(found.length)}; ask with a query to narrow it.)` : ''
      return mcpText(shown.join('\n') + more)
    }
    if (name === 'read_file') {
      const asked = text(args.path)
      if (asked === undefined) return mcpText('Say which file, as its path in the folder.', true)
      const found = await inside(root, asked)
      if (typeof found === 'string') return mcpText(found, true)
      const info = await stat(found.full).catch(() => undefined)
      if (info === undefined || !info.isFile()) return mcpText(`${found.shown} is not a file.`, true)
      const body = await head(found.full, MAX_READ_BYTES).catch(() => undefined)
      if (body === undefined) return mcpText(`${found.shown} is not text, so a call cannot read it out.`, true)
      const lines = body.split(/\r?\n/)
      const from = Math.max(1, Math.floor(typeof args.from_line === 'number' ? args.from_line : 1))
      const upTo = Math.min(lines.length, from + LINES_PER_READ - 1)
      if (from > lines.length) return mcpText(`${found.shown} has ${String(lines.length)} lines.`, true)
      const cut = info.size > MAX_READ_BYTES ? ` (only the first ${String(Math.round(MAX_READ_BYTES / 1024))} KB of ${String(Math.round(info.size / 1024))} KB are read)` : ''
      const rest = upTo < lines.length ? ` Ask again with from_line ${String(upTo + 1)} for more.` : ''
      return mcpText(`${found.shown}, lines ${String(from)}-${String(upTo)} of ${String(lines.length)}${cut}.${rest}\n\n${lines.slice(from - 1, upTo).join('\n')}`)
    }
    if (name === 'search_files') {
      const wanted = text(args.text)
      if (wanted === undefined) return mcpText('Say what to look for.', true)
      const needle = wanted.toLowerCase()
      const { paths } = await list(root)
      const matches: string[] = []
      let searched = 0
      for (const path of paths) {
        if (matches.length >= MAX_MATCHES || searched >= MAX_SEARCHED_FILES) break
        if (SECRET.test(path)) continue
        const found = await inside(root, path)
        if (typeof found === 'string') continue
        const info = await stat(found.full).catch(() => undefined)
        if (info === undefined || !info.isFile() || info.size > MAX_SEARCHED_BYTES) continue
        searched += 1
        const body = await head(found.full, MAX_SEARCHED_BYTES).catch(() => undefined)
        if (body === undefined || !body.toLowerCase().includes(needle)) continue
        const lines = body.split(/\r?\n/)
        for (let index = 0; index < lines.length && matches.length < MAX_MATCHES; index += 1) {
          if (lines[index]!.toLowerCase().includes(needle)) matches.push(`${found.shown}:${String(index + 1)}: ${lines[index]!.trim().slice(0, 200)}`)
        }
      }
      if (matches.length === 0) return mcpText(`"${wanted}" is in none of the ${String(searched)} files searched.`)
      return mcpText(matches.join('\n') + (matches.length >= MAX_MATCHES ? `\n(The first ${String(MAX_MATCHES)} matches.)` : ''))
    }
    return mcpText('A voice call cannot do that.', true)
  }
}
