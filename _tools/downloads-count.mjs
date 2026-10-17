// Who used dl.locust.lol, per day, from Cloudflare's own request analytics (Locust itself has no telemetry).
// Counts distinct addresses, not requests, and leaves out this machine's own. Uses wrangler's OAuth login in place
// (never printed). Usage: node _tools/downloads-count.mjs [days=1]
//
// A download is the whole installer, fetched by a browser. On 2026-10-17, 10 of the 15 "Windows downloads" counted
// by address alone were Facebook's link-preview crawler fetching the installer for a shared link, and 3 were phones
// that stopped after a few MB.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ZONE = '06b01b5e069915054fa4e70bcdc80232'
const days = Number(process.argv[2] ?? 1)
const CONFIG = join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml')
// The login lasts an hour. Any wrangler command renews it from its refresh token, so an expired one is renewed
// with `wrangler whoami`, run from the site checkout that has wrangler installed.
let config = readFileSync(CONFIG, 'utf8')
const expires = Date.parse(/expiration_time\s*=\s*"([^"]+)"/.exec(config)?.[1] ?? '')
if (!(expires > Date.now() + 60_000)) {
  spawnSync('npx wrangler whoami', { cwd: join(homedir(), 'Documents', 'locust-site'), shell: true, stdio: 'ignore' })
  config = readFileSync(CONFIG, 'utf8')
}
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1]
if (!token) { console.error('no wrangler login'); process.exit(1) }
const me = /ip=(\S+)/.exec(await (await fetch('https://dl.locust.lol/cdn-cgi/trace')).text())?.[1]

const query = `query($zone: String!, $since: Time!, $until: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
  httpRequestsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: "dl.locust.lol", requestSource: "eyeball", clientRequestHTTPMethodName: "GET" }) {
    sum { edgeResponseBytes } dimensions { date clientIP clientRequestPath edgeResponseStatus userAgent } } } } }`
const rows = []
// One day per query: the free plan answers a day at a time.
for (let back = days; back > 0; back -= 1) {
  const until = new Date(Date.now() - (back - 1) * 86400_000)
  const since = new Date(until.getTime() - 86400_000)
  const answer = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { zone: ZONE, since: since.toISOString(), until: until.toISOString() } }),
  })
  const body = await answer.json()
  if (body.errors?.length) { console.error(JSON.stringify(body.errors).slice(0, 600)); process.exit(1) }
  rows.push(...(body.data.viewer.zones[0]?.httpRequestsAdaptiveGroups ?? []))
}

// Whole is at least 95% of the installer's size in the release the site offers; an older installer, 100 MB.
const sizes = new Map()
const release = await fetch('https://dl.locust.lol/release.json').then((answer) => answer.json()).catch(() => ({}))
for (const asset of release.assets ?? []) if (typeof asset.size === 'number') sizes.set(`/${asset.name}`, asset.size)
const whole = (path, bytes) => bytes >= 0.95 * (sizes.get(path) ?? 100e6)
// Link previews, search engines and scripts. Locust's own update checks say electron-builder (Windows) and node (Mac).
const CRAWLER = /bot|crawl|spider|slurp|externalhit|preview|python|curl|wget|go-http|okhttp|headless/i
const INSTALLERS = [
  ['downloaded for Windows', (p) => p === '/Locust-Setup.exe'],
  ['downloaded for Mac', (p) => p.endsWith('.dmg')],
]
const KINDS = [
  ['updated', (p) => /^\/Locust-[\d.]+-setup\.exe$/.test(p)],
  ['copies checking for updates', (p) => p === '/latest.yml' || p === '/beta.yml' || p === '/mac-releases.json'],
  ['visited locust.lol (read release.json)', (p) => p === '/release.json'],
]
const byDay = new Map()
for (const { sum, dimensions: d } of rows) {
  if (d.clientIP === me || d.edgeResponseStatus >= 400) continue
  const day = byDay.get(d.date) ?? { bytes: new Map(), seen: new Map(KINDS.map(([name]) => [name, new Set()])), crawlers: new Set() }
  byDay.set(d.date, day)
  if (!d.userAgent || CRAWLER.test(d.userAgent)) {
    day.crawlers.add(d.clientIP)
    continue
  }
  // An installer can come down in several requests, so its bytes are added up per address.
  if (INSTALLERS.some(([, match]) => match(d.clientRequestPath))) {
    const key = `${d.clientRequestPath} ${d.clientIP}`
    day.bytes.set(key, (day.bytes.get(key) ?? 0) + sum.edgeResponseBytes)
  }
  for (const [name, match] of KINDS) if (match(d.clientRequestPath)) day.seen.get(name).add(d.clientIP)
}
const line = (count, name) => console.log(`  ${String(count).padStart(4)}  ${name}`)
for (const [date, day] of [...byDay].sort()) {
  const got = new Map(INSTALLERS.map(([name]) => [name, new Set()]))
  const started = new Set()
  for (const [key, bytes] of day.bytes) {
    const [path, ip] = key.split(' ')
    if (whole(path, bytes)) got.get(INSTALLERS.find(([, match]) => match(path))[0]).add(ip)
    else started.add(ip)
  }
  const gotOne = new Set([...got.values()].flatMap((ips) => [...ips]))
  console.log(date)
  for (const [name, ips] of got) line(ips.size, name)
  line([...started].filter((ip) => !gotOne.has(ip)).length, 'started a download and stopped partway')
  for (const [name, ips] of day.seen) line(ips.size, name)
  line(day.crawlers.size, 'link previews and crawlers, left out')
}
if (byDay.size === 0) console.log('nobody but this machine yet')
