import { describe, expect, it } from 'vitest'

import { createPullLinkWatch } from './pullLinkWatch.js'
import type { LinkedPullRequest, PullLinkAddress } from '../../shared/pull-request.js'

/*
 * Shown links share one read. A minute later the window coming forward reads
 * again. A timer runs only while checks are still running, and a link that
 * has left the screen is not read.
 */

const address: PullLinkAddress = { owner: 'acme', repo: 'app', number: 42 }
const passing: LinkedPullRequest = { state: 'open', checks: 'passing', passed: 2, failed: 0, running: 0, total: 2 }
const running: LinkedPullRequest = { state: 'open', checks: 'running', passed: 3, failed: 0, running: 1, total: 4 }

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function harness(answer: LinkedPullRequest) {
  let time = 1_000
  let reads = 0
  let focus: (() => void) | undefined
  let tick: (() => void) | undefined
  let saved: (() => void) | undefined
  let everyMs: number | undefined
  const watch = createPullLinkWatch({
    read: async () => {
      reads += 1
      return answer
    },
    now: () => time,
    every: (ms, fn) => {
      everyMs = ms
      tick = fn
      saved = fn
      return () => {
        tick = undefined
      }
    },
    onFocus: (fn) => {
      focus = fn
      return () => {
        focus = undefined
      }
    }
  })
  return {
    watch,
    reads: () => reads,
    focus: () => focus?.(),
    tick: () => tick?.(),
    saved: () => saved?.(),
    armed: () => tick !== undefined,
    focused: () => focus !== undefined,
    everyMs: () => everyMs,
    advance: (ms: number) => {
      time += ms
    }
  }
}

describe('pull request links on screen', () => {
  it('reads once for many links, and again when the window comes back after a minute', async () => {
    const h = harness(passing)
    const stop1 = h.watch.watch(address, () => undefined)
    const stop2 = h.watch.watch(address, () => undefined)
    const stop3 = h.watch.watch(address, () => undefined)
    await flush()
    expect(h.reads()).toBe(1)
    h.focus()
    await flush()
    expect(h.reads()).toBe(1)
    h.watch.watch(address, () => undefined)
    await flush()
    expect(h.reads()).toBe(1)
    h.advance(60_000)
    h.focus()
    await flush()
    expect(h.reads()).toBe(2)
    stop1()
    stop2()
    stop3()
  })

  it('does not keep a timer once the checks have settled', async () => {
    const h = harness(passing)
    const stop = h.watch.watch(address, () => undefined)
    await flush()
    expect(h.armed()).toBe(false)
    stop()
    expect(h.focused()).toBe(false)
  })

  it('reads every few minutes only while checks are running, and stops when the link is gone', async () => {
    const h = harness(running)
    const stop = h.watch.watch(address, () => undefined)
    await flush()
    expect(h.reads()).toBe(1)
    expect(h.armed()).toBe(true)
    expect(h.everyMs()).toBe(180_000)
    h.tick()
    await flush()
    expect(h.reads()).toBe(2)
    stop()
    expect(h.armed()).toBe(false)
    expect(h.focused()).toBe(false)
    h.saved()
    await flush()
    expect(h.reads()).toBe(2)
  })

  it('reads nothing when gh cannot', async () => {
    let reads = 0
    const watch = createPullLinkWatch({
      read: async () => {
        reads += 1
        return undefined
      }
    })
    const heard: (LinkedPullRequest | undefined)[] = []
    const stop = watch.watch(address, () => heard.push(watch.current(address)))
    await flush()
    expect(reads).toBe(1)
    expect(watch.current(address)).toBeUndefined()
    expect(heard).toEqual([undefined])
    stop()
  })
})
