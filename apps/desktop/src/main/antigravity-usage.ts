import { execFile } from 'node:child_process'
import type { RuntimeDiscovery } from '@teammate/runtime-adapters'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read only the CLI's built-in usage command, never a prompt or a login file. */
export function readAntigravityUsage(executable: NonNullable<RuntimeDiscovery['executable']>, version: RuntimeDiscovery['version']): Promise<unknown> {
  // Before 1.1.11, /usage can be a model prompt rather than a built-in command.
  // Unknown versions fail closed, before any process is started.
  if (version === undefined || ![version.major, version.minor, version.patch].every(part => Number.isSafeInteger(part) && part >= 0)
    || !(version.major > 1 || (version.major === 1 && (version.minor > 1
      || (version.minor === 1 && (version.patch > 11 || (version.patch === 11 && !version.prerelease))))))
    || executable.prefixArgs.includes('--disable-slash-commands')) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(executable.executablePath, [...executable.prefixArgs, '-p', '/usage', '--output-format', 'json', '--print-timeout', '20s'], {
      windowsHide: true,
      shell: false,
      timeout: 30_000,
      maxBuffer: 256 * 1024,
      env: { ...process.env, ...executable.env }
    }, (error, stdout) => {
      if (error !== null) { resolve(undefined); return }
      try { resolve(JSON.parse(stdout)) } catch { resolve(undefined) }
    })
  })
}

/** The groups Antigravity has always named, said shorter. */
const GROUP_LABELS: Readonly<Record<string, string>> = { 'Gemini Models': 'Gemini', 'Claude and GPT models': 'Claude and GPT' }

/*
 * Any other group is said by its own name. Antigravity added "Gemini 4 Argon"
 * with a weekly limit of its own (2026-10-16), and a group this did not know,
 * or one with a single window, threw the whole reading away: Antigravity's
 * usage vanished from the app for everyone with Argon. A name is shown only
 * when it reads as one: short, one line, and free of what the window line is
 * read by.
 */
function groupLabel(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined
  const known = GROUP_LABELS[name]
  if (known !== undefined) return known
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= 40 && !/[·%\p{Cc}]/u.test(trimmed) ? trimmed : undefined
}

/** Gemini's windows first, the short window first; another group is included when its remaining limit is lower. */
export function antigravityUsageText(answer: unknown): string | undefined {
  if (!object(answer) || answer.status !== 'SUCCESS' || answer.num_turns !== 0
    || !object(answer.command) || answer.command.name !== 'usage' || !object(answer.command.data)
    || !Array.isArray(answer.command.data.groups)) return undefined

  const groups = new Map<string, { text: string; remaining: number }>()
  for (const group of answer.command.data.groups) {
    if (!object(group) || !Array.isArray(group.buckets)) return undefined
    const label = groupLabel(group.name)
    if (label !== undefined && groups.has(label)) return undefined
    const buckets = new Map<string, { remaining: number; reset?: string }>()
    for (const bucket of group.buckets) {
      if (!object(bucket)) return undefined
      // A window Locust has no words for is left out; the others still stand.
      if (bucket.window !== '5h' && bucket.window !== 'weekly') continue
      if (typeof bucket.remaining_fraction !== 'number' || !Number.isFinite(bucket.remaining_fraction)
        || bucket.remaining_fraction < 0 || bucket.remaining_fraction > 1 || buckets.has(bucket.window)) return undefined
      const reset = typeof bucket.reset_time === 'string' && Number.isFinite(Date.parse(bucket.reset_time))
        ? new Date(bucket.reset_time).toISOString() : undefined
      // A full bucket's moving "now + window" is not a scheduled refresh.
      buckets.set(bucket.window, { remaining: bucket.remaining_fraction, ...(bucket.remaining_fraction === 1 || reset === undefined ? {} : { reset }) })
    }
    if (label === undefined || buckets.size === 0) continue
    const text = ['5h', 'weekly'].filter((window) => buckets.has(window)).map((window) => {
      const bucket = buckets.get(window)!
      return `${label}: ${window === '5h' ? '5-hour' : 'weekly'} window ${String(Math.round(bucket.remaining * 100))}% left${bucket.reset === undefined ? '' : ` · resets ${bucket.reset}`}`
    }).join(' · ')
    groups.set(label, { text, remaining: Math.min(...[...buckets.values()].map((bucket) => bucket.remaining)) })
  }
  const shown = [...groups.values()]
  const first = groups.get('Gemini') ?? shown[0]
  if (first === undefined) return undefined
  return [first, ...shown.filter((group) => group !== first && group.remaining < first.remaining)].map((group) => group.text).join(' · ')
}
