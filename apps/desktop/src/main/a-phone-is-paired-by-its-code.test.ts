import { mkdtemp, readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createPhoneHost, phoneAddresses, type PhoneCalls } from './phone-host.js'
import { phonePage } from './phone-page.js'

/*
 * YOUR PHONE (0.775). The page is anyone's; what it shows and does is only for the phone that scanned the code, on
 * this computer's address, never a name (a page elsewhere trying DNS rebinding).
 */
const calls = (): PhoneCalls & { decided: [string, boolean][]; sent: [string, string][] } => {
  const decided: [string, boolean][] = []
  const sent: [string, string][] = []
  return {
    decided,
    sent,
    state: async () => ({ waiting: [{ approvalId: 'a1', missionId: 'm1', summary: 'Run npm test', requestedAt: '2026-10-15T12:00:00.000Z' }], conversations: [] }),
    turns: async (id) => (id === 'm1' ? [{ missionId: 'm1', asked: 'hi', answer: 'hello', agent: 'Codex CLI', at: '2026-10-15T12:00:00.000Z', phase: 'completed' }] : undefined),
    decide: async (id, approve) => { decided.push([id, approve]); return true },
    send: async (id, text) => { sent.push([id, text]); return { ok: true } }
  }
}

async function phone(c = calls()) {
  const directory = await mkdtemp(join(tmpdir(), 'locust-phone-'))
  const host = createPhoneHost({ directory, page: phonePage, calls: c, addresses: () => ['127.0.0.1'], port: 0, protectFile: async () => undefined })
  return { host, directory, c }
}

const keyOf = (url: string | undefined): string => (url ?? '').split('#')[1] ?? ''
const base = (url: string | undefined): string => (url ?? '').split('#')[0]!.replace(/\/$/, '')
const get = (url: string, key?: string) => fetch(url, { headers: key === undefined ? {} : { authorization: `Bearer ${key}` } })
/** fetch sends its own Host; this one says whatever a page elsewhere would. */
const getAs = (url: string, key: string, host: string): Promise<number> => new Promise((resolve, reject) => {
  request(url, { headers: { authorization: `Bearer ${key}`, host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) }).on('error', reject).end()
})
const post = (url: string, key: string, body: unknown, type = 'application/json') =>
  fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': type }, body: JSON.stringify(body) })

describe('your phone', () => {
  it('is off until turned on, and off means no address at all', async () => {
    const { host } = await phone()
    const settings = await host.load()
    expect(settings.enabled).toBe(false)
    expect(settings.url).toBeUndefined()
  })

  it('serves the page to anyone, and nothing else without the key from the code', async () => {
    const { host } = await phone()
    const on = await host.setEnabled(true)
    expect(on.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#[A-Za-z0-9_-]{32}$/)
    const page = await get(`${base(on.url)}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await page.text()).toContain('Pair this phone with Locust')
    expect((await get(`${base(on.url)}/api/state`)).status).toBe(401)
    expect((await get(`${base(on.url)}/api/state`, 'x'.repeat(32))).status).toBe(401)
    const state = await get(`${base(on.url)}/api/state`, keyOf(on.url))
    expect(state.status).toBe(200)
    expect(((await state.json()) as { waiting: unknown[] }).waiting).toHaveLength(1)
    await host.dispose()
  })

  it('refuses a request that names this computer by a name, as a rebinding page would', async () => {
    const { host } = await phone()
    const on = await host.setEnabled(true)
    const port = new URL(base(on.url)).port
    expect(await getAs(`${base(on.url)}/api/state`, keyOf(on.url), `evil.example:${port}`)).toBe(421)
    expect(await getAs(`${base(on.url)}/api/state`, keyOf(on.url), `127.0.0.1:${port}`)).toBe(200)
    await host.dispose()
  })

  it('answers a card and sends a message only as JSON with the key', async () => {
    const { host, c } = await phone()
    const on = await host.setEnabled(true)
    const key = keyOf(on.url)
    expect(await (await post(`${base(on.url)}/api/decide`, key, { approvalId: 'a1', approve: false })).json()).toEqual({ ok: true })
    expect(c.decided).toEqual([['a1', false]])
    expect((await post(`${base(on.url)}/api/send`, key, { missionId: 'm1', text: 'and again' }, 'text/plain')).status).toBe(415)
    expect((await post(`${base(on.url)}/api/send`, key, { missionId: 'm1', text: '   ' })).status).toBe(400)
    expect(await (await post(`${base(on.url)}/api/send`, key, { missionId: 'm1', text: ' and again ' })).json()).toEqual({ ok: true })
    expect(c.sent).toEqual([['m1', 'and again']])
    const turns = await get(`${base(on.url)}/api/turns?id=m1`, key)
    expect(((await turns.json()) as { turns: unknown[] }).turns).toHaveLength(1)
    expect((await get(`${base(on.url)}/api/turns?id=gone`, key)).status).toBe(404)
    await host.dispose()
  })

  it('stops listening to an address after too many wrong keys', async () => {
    const { host } = await phone()
    const on = await host.setEnabled(true)
    for (let tries = 0; tries < 20; tries += 1) await get(`${base(on.url)}/api/state`, 'y'.repeat(32))
    // Even the right key, from there, for a while.
    expect((await get(`${base(on.url)}/api/state`, keyOf(on.url))).status).toBe(429)
    await host.dispose()
  })

  it('answers a key of the right length in characters but not in bytes, and counts it as wrong (review 2026-10-15, C2)', async () => {
    const { host } = await phone()
    const on = await host.setEnabled(true)
    // Latin-1 header bytes: 32 characters, 64 bytes in UTF-8. timingSafeEqual used to throw before answering.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${base(on.url)}/api/state`, { headers: { authorization: Buffer.from(`Bearer ${'é'.repeat(32)}`, 'latin1').toString('latin1') } }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
      req.on('error', reject)
      req.setTimeout(3_000, () => { req.destroy(new Error('no answer')) })
      req.end()
    })
    expect(status).toBe(401)
    // The control: the right key still works.
    expect((await get(`${base(on.url)}/api/state`, keyOf(on.url))).status).toBe(200)
    await host.dispose()
  })

  it('keeps its key across a restart, so a paired phone stays paired', async () => {
    const { host, directory, c } = await phone()
    const on = await host.setEnabled(true)
    await host.dispose()
    const again = createPhoneHost({ directory, page: phonePage, calls: c, addresses: () => ['127.0.0.1'], port: 0, protectFile: async () => undefined })
    const loaded = await again.load()
    expect(loaded.enabled).toBe(true)
    expect(keyOf(loaded.url)).toBe(keyOf(on.url))
    await again.dispose()
  })

  it('off unpairs every phone, and a new code does it while staying on', async () => {
    const { host, directory } = await phone()
    const first = await host.setEnabled(true)
    const renewed = await host.forget()
    expect(keyOf(renewed.url)).not.toBe(keyOf(first.url))
    expect((await get(`${base(renewed.url)}/api/state`, keyOf(first.url))).status).toBe(401)
    expect((await get(`${base(renewed.url)}/api/state`, keyOf(renewed.url))).status).toBe(200)
    await host.setEnabled(false)
    expect(JSON.parse(await readFile(join(directory, 'phone.json'), 'utf8'))).toEqual({ enabled: false })
    const back = await host.setEnabled(true)
    expect(keyOf(back.url)).not.toBe(keyOf(renewed.url))
    await host.dispose()
  })

  it('offers home-network addresses, never a virtual switch a phone cannot reach', () => {
    const entry = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null })
    expect(phoneAddresses({
      'vEthernet (WSL)': [entry('172.20.0.1')],
      Loopback: [entry('127.0.0.1', true)],
      Tailscale: [entry('100.101.1.2')],
      'Wi-Fi': [entry('192.168.1.23'), { ...entry('fe80::1'), family: 'IPv6' as const, scopeid: 0 }],
      Ethernet: [entry('8.8.8.8')]
    })).toEqual(['192.168.1.23', '100.101.1.2'])
  })
})
