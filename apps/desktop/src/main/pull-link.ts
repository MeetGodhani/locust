import { LINK_PULL_FIELDS, linkedPullRequestOf, pullLinkRequest } from '../shared/pull-request.js'
import type { LinkedPullRequest, PullLinkAddress } from '../shared/pull-request.js'

/**
 * Read a linked pull request with the person's own gh.
 *
 * Many links to one pull request share one read. A conversation full of
 * different ones runs a few gh processes at a time, not one each. A missing
 * gh and a repository gh cannot see are the same answer: nothing, and nothing
 * said. The error is not kept — gh can print a token into it.
 */
const MINUTE_MS = 60_000
const AT_ONCE = 2

export function createPullLinkReader(options: {
  readonly gh: (args: readonly string[]) => Promise<string>
  readonly now?: () => number
  readonly cacheForMs?: number
  readonly atOnce?: number
}): { read(request: unknown): Promise<LinkedPullRequest | undefined> } {
  const now = options.now ?? (() => Date.now())
  const cacheForMs = options.cacheForMs ?? MINUTE_MS
  const atOnce = options.atOnce ?? AT_ONCE
  const cache = new Map<string, { at: number; value: LinkedPullRequest | undefined }>()
  const flying = new Map<string, Promise<LinkedPullRequest | undefined>>()
  let running = 0
  const waiting: (() => void)[] = []

  const take = (): Promise<void> => {
    if (running < atOnce) {
      running += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      waiting.push(resolve)
    })
  }
  // The next waiter takes this slot; running stays where it is.
  const release = (): void => {
    const next = waiting.shift()
    if (next !== undefined) next()
    else running -= 1
  }

  const keyOf = (address: PullLinkAddress): string => `${address.owner}/${address.repo}#${String(address.number)}`

  const ask = async (address: PullLinkAddress): Promise<LinkedPullRequest | undefined> => {
    await take()
    try {
      const json = await options.gh([
        'pr', 'view', String(address.number),
        '--repo', `${address.owner}/${address.repo}`,
        '--json', LINK_PULL_FIELDS
      ])
      return linkedPullRequestOf(json)
    } catch {
      return undefined
    } finally {
      release()
    }
  }

  const read = (request: unknown): Promise<LinkedPullRequest | undefined> => {
    const address = pullLinkRequest(request)
    if (address === undefined) return Promise.resolve(undefined)
    const key = keyOf(address)
    const kept = cache.get(key)
    if (kept !== undefined && now() - kept.at < cacheForMs) return Promise.resolve(kept.value)
    const existing = flying.get(key)
    if (existing !== undefined) return existing
    const job = ask(address).then((value) => {
      cache.set(key, { at: now(), value })
      return value
    })
    flying.set(key, job)
    void job.finally(() => {
      if (flying.get(key) === job) flying.delete(key)
    })
    return job
  }

  return { read }
}
