import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import { startAppServerProcess } from './app-server-process.js'
import type { AppServerChild } from './app-server-process.js'

function fixture() {
  const stdout = new PassThrough()
  const kill = vi.fn()
  const child: AppServerChild = { stdin: { write: () => true }, stdout, on: () => undefined, kill }
  const process = startAppServerProcess('agent', ['acp'], { spawn: () => child, releaseTree: async () => true, platform: 'linux' })
  return { stdout, process, kill }
}

describe('an app-server output close', () => {
  it('flushes the pending decoder before reporting EOF once across end, close and error', () => {
    const f = fixture()
    const order: string[] = []
    f.process.onData((chunk) => order.push(chunk))
    f.process.onStdoutClose?.(() => order.push('closed'))
    f.stdout.emit('data', Buffer.from([0xe2, 0x82]))
    f.stdout.emit('end')
    f.stdout.emit('close')
    f.stdout.emit('error', new Error('late error'))
    expect(order).toEqual(['\ufffd', 'closed'])
    const late = vi.fn()
    f.process.onStdoutClose?.(late)
    expect(late).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('reports stdout errors to a listener registered after the stream failed', () => {
    const f = fixture()
    const failure = new Error('pipe failed')
    const observed = vi.fn()
    f.stdout.emit('error', failure)
    f.process.onStdoutClose?.(observed)
    expect(observed).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('accepts existing process doubles that only implement stdout data', () => {
    const data = vi.fn()
    const child: AppServerChild = { stdin: { write: () => true }, stdout: { on: data }, on: () => undefined, kill: () => undefined }
    const process = startAppServerProcess('agent', ['acp'], { spawn: () => child, releaseTree: async () => true, platform: 'linux' })
    process.onData(() => undefined)
    process.onStdoutClose?.(() => undefined)
    expect(data.mock.calls.map((call) => call[0])).toEqual(['data'])
  })

  it('falls back to killing the child when releasing its tree rejects', async () => {
    const kill = vi.fn()
    const child: AppServerChild = { pid: 42, stdin: { write: () => true }, stdout: { on: () => undefined }, on: () => undefined, kill }
    const process = startAppServerProcess('agent', ['acp'], { spawn: () => child, releaseTree: async () => { throw new Error('unavailable') }, platform: 'linux' })
    process.kill()
    process.kill()
    await Promise.resolve()
    await Promise.resolve()
    expect(kill).toHaveBeenCalledTimes(1)
  })
})
