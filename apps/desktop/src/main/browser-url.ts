import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isLoopbackOrWorkspaceOrigin, type ResolvedBrowserUrl } from '../shared/browser.js'

const BLOCKED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'vbscript:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'devtools:',
  'about:',
  'view-source:',
  'ws:',
  'wss:',
  'ftp:',
  'mailto:',
  'tel:',
  'locust-page:'
])

function safeRealpath(target: string, realpath: (path: string) => string = realpathSync): string {
  const abs = resolve(target)
  let current = abs
  const suffix: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return abs
    suffix.unshift(relative(parent, current))
    current = parent
  }
  try {
    const resolvedBase = realpath(current)
    return suffix.length > 0 ? resolve(resolvedBase, ...suffix) : resolvedBase
  } catch {
    return abs
  }
}

export function isPathInsideWorkspace(
  targetPath: string,
  workspaceRoot: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  const realWorkspace = safeRealpath(workspaceRoot, realpath)
  const realTarget = safeRealpath(targetPath, realpath)
  const normWorkspace = process.platform === 'win32' ? realWorkspace.toLowerCase() : realWorkspace
  const normTarget = process.platform === 'win32' ? realTarget.toLowerCase() : realTarget
  const rel = relative(normWorkspace, normTarget)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function resolveBrowserUrl(
  rawInput: string,
  optionsOrWorkspaceRoot?:
    | string
    | {
        readonly workspaceRoot?: string
        readonly realpath?: (path: string) => string
      }
): ResolvedBrowserUrl {
  const options =
    typeof optionsOrWorkspaceRoot === 'string'
      ? { workspaceRoot: optionsOrWorkspaceRoot }
      : optionsOrWorkspaceRoot
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return { ok: false, message: 'Enter a web address or a file inside this conversation folder. The current page stayed open.' }
  }

  const isHostPort = /^(localhost|127\.0\.0\.1|\[::1\]|[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+):\d+(\/|$|[?#])/i.test(trimmed)
  const isWindowsDrive = /^[a-zA-Z]:[\\/]/.test(trimmed)
  const schemeMatch = !isHostPort && !isWindowsDrive ? /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(trimmed) : null
  const lowerScheme = schemeMatch?.[1]?.toLowerCase()
  if (lowerScheme !== undefined && BLOCKED_SCHEMES.has(lowerScheme)) {
    return {
      ok: false,
      message: `The ${lowerScheme} scheme is not allowed in the Locust browser. The current page stayed open.`
    }
  }

  let candidate = trimmed
  if (lowerScheme === undefined) {
    if (
      options?.workspaceRoot &&
      (trimmed.startsWith('./') ||
        trimmed.startsWith('../') ||
        trimmed.startsWith('.\\') ||
        trimmed.startsWith('..\\') ||
        /\.html?(?:[?#].*)?$/i.test(trimmed))
    ) {
      const hashIdx = trimmed.indexOf('#')
      const queryIdx = trimmed.indexOf('?')
      const cut = [hashIdx, queryIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? trimmed.length
      const relPart = trimmed.slice(0, cut)
      const tail = trimmed.slice(cut)
      const fullPath = resolve(options.workspaceRoot, relPart)
      candidate = pathToFileURL(fullPath).toString() + tail
    } else if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(\/|$)/i.test(trimmed)) {
      candidate = `http://${trimmed}`
    } else if (/^[a-zA-Z]:[\\/]/.test(trimmed)) {
      candidate = pathToFileURL(trimmed).toString()
    } else {
      candidate = `https://${trimmed}`
    }
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, message: `"${trimmed}" is not a valid address. The current page stayed open.` }
  }

  const protocol = parsed.protocol.toLowerCase()
  if (BLOCKED_SCHEMES.has(protocol)) {
    return {
      ok: false,
      message: `The ${protocol} scheme is not allowed in the Locust browser. The current page stayed open.`
    }
  }

  if (protocol === 'file:') {
    if (!options?.workspaceRoot) {
      return {
        ok: false,
        message: 'Local file URLs require an open conversation folder. The current page stayed open.'
      }
    }
    let targetPath: string
    try {
      targetPath = fileURLToPath(parsed)
    } catch {
      return { ok: false, message: `"${trimmed}" is not a valid local file URL. The current page stayed open.` }
    }
    if (!isPathInsideWorkspace(targetPath, options.workspaceRoot, options.realpath)) {
      return {
        ok: false,
        message: `Local files outside ${options.workspaceRoot} are blocked in the Locust browser. The current page stayed open.`
      }
    }
    const realTarget = safeRealpath(targetPath, options.realpath)
    const canonical = pathToFileURL(realTarget)
    canonical.search = parsed.search
    canonical.hash = parsed.hash
    return {
      ok: true,
      url: canonical.toString(),
      origin: 'file://workspace',
      filePath: realTarget
    }
  }

  if (protocol === 'http:' || protocol === 'https:') {
    if (!parsed.hostname) {
      return { ok: false, message: `"${trimmed}" is missing a host name. The current page stayed open.` }
    }
    return {
      ok: true,
      url: parsed.toString(),
      origin: parsed.origin.toLowerCase()
    }
  }

  return {
    ok: false,
    message: `Only http:, https:, and workspace file: addresses can open in the Locust browser. The current page stayed open.`
  }
}

export { isLoopbackOrWorkspaceOrigin }
