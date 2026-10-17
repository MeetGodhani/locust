// Who used dl.locust.lol, per day, from Cloudflare's own request analytics (Locust itself has no telemetry).
// Counts distinct addresses, not requests, and leaves out this machine's own. Uses wrangler's OAuth login in place
// (never printed). Usage: node _tools/downloads-count.mjs [days=1]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ZONE = '06b01b5e069915054fa4e70bcdc80232'
const days = Number(process.argv[2] ?? 1)
const config = readFileSync(join(process.env.APPDATA, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'utf8')
const token = /oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1]
if (!token) { console.error('no wrangler login'); process.exit(1) }
const me = /ip=(\S+)/.exec(await (await fetch('https://dl.locust.lol/cdn-cgi/trace')).text())?.[1]

const query = `query($zone: String!, $since: Time!, $until: Time!) { viewer { zones(filter: { zoneTag: $zone }) {
  httpRequestsAdaptiveGroups(limit: 5000, filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: "dl.locust.lol", requestSource: "eyeball", clientRequestHTTPMethodName: "GET" }) {
    count dimensions { date clientIP clientRequestPath edgeResponseStatus } } } } }`
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

const KINDS = [
  ['downloaded for Windows', (p) => p === '/Locust-Setup.exe'],
  ['downloaded for Mac', (p) => p.endsWith('.dmg')],
  ['updated', (p) => /^\/Locust-[\d.]+-setup\.exe$/.test(p)],
  ['copies checking for updates', (p) => p === '/latest.yml' || p === '/beta.yml' || p === '/mac-releases.json'],
  ['visited locust.lol (read release.json)', (p) => p === '/release.json'],
]
const byDay = new Map()
for (const { dimensions: d } of rows) {
  if (d.clientIP === me || d.edgeResponseStatus >= 400) continue
  const day = byDay.get(d.date) ?? new Map(KINDS.map(([name]) => [name, new Set()]))
  for (const [name, match] of KINDS) if (match(d.clientRequestPath)) day.get(name).add(d.clientIP)
  byDay.set(d.date, day)
}
for (const [date, day] of [...byDay].sort()) {
  console.log(date)
  for (const [name, ips] of day) console.log(`  ${String(ips.size).padStart(4)}  ${name}`)
}
if (byDay.size === 0) console.log('nobody but this machine yet')
