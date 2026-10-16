// Publish a built release to Locust's own downloads (dl.locust.lol, a Cloudflare R2 bucket), and refuse to until
// every file is really there.
//
//   node _tools/publish-downloads.mjs <version>                every build: installer, block map, then beta.yml
//   node _tools/publish-downloads.mjs <version> --mac <dir>    the Mac disk images for <version>, from the CI run
//   node _tools/publish-downloads.mjs <version> --promote      the tester lane: latest.yml, Locust-Setup.exe and the
//                                                              Mac release list, once a day
//
// WHY (0.783). GitHub suspended the account that held Locust's releases on 2026-10-16 and every installed copy's
// update check failed with it (src/shared/locust-home.ts). The rules publish-release.mjs learned on GitHub hold
// here too: every upload is its own command with its own exit code, each file is read back over HTTPS at the size
// on disk, and the feed file goes LAST, so no copy is ever pointed at an installer that is not there yet.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BUCKET = 'locust-downloads'
const DOWNLOADS = 'https://dl.locust.lol/'
const RELEASE = new URL('../apps/desktop/release/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const version = process.argv[2]
const flag = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] ?? '' : undefined)
const promote = process.argv.includes('--promote')
const macDir = flag('--mac')
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version) || macDir === '') {
  console.error('usage: node _tools/publish-downloads.mjs <version> [--mac <dir> | --promote]')
  process.exit(2)
}

const say = (line) => console.log(line)
const fail = (line) => {
  console.error(`\nNOT PUBLISHED: ${line}\nThe feed files were not changed, so no installed Locust sees anything new.`)
  process.exit(1)
}
const TYPES = { '.exe': 'application/vnd.microsoft.portable-executable', '.dmg': 'application/x-apple-diskimage', '.yml': 'text/yaml; charset=utf-8', '.json': 'application/json', '.blockmap': 'application/octet-stream' }
const typeOf = (name) => TYPES[Object.keys(TYPES).find((ending) => name.endsWith(ending)) ?? '.blockmap']

// No shell: wrangler is run by node from npx's own script, with fixed arguments.
function put(key, file, { fresh = false } = {}) {
  const run = spawnSync(process.execPath, [npxCli(), '--yes', 'wrangler@4', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote', '--content-type', typeOf(key), ...(fresh ? ['--cache-control', 'no-cache'] : [])], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (run.status !== 0) fail(`uploading ${key} failed (exit ${String(run.status)}): ${(run.stderr || run.stdout || '').trim().slice(-400)}`)
}
function npxCli() {
  const cli = join(process.execPath, '..', 'node_modules', 'npm', 'bin', 'npx-cli.js')
  if (!existsSync(cli)) fail(`npx is not where node keeps it (${cli})`)
  return cli
}
// What the world sees, not what the upload said: a HEAD over HTTPS, at the size on disk.
async function served(key, size) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const answer = await fetch(`${DOWNLOADS}${key}?check=${String(Date.now())}`, { method: 'HEAD' }).catch(() => undefined)
    if (answer?.ok === true && Number(answer.headers.get('content-length')) === size) return
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
  fail(`${DOWNLOADS}${key} does not answer at ${String(size)} bytes`)
}
async function upload(key, file, options) {
  const size = statSync(file).size
  put(key, file, options)
  await served(key, size)
  say(`  ${key}  ${String(size)} bytes, served`)
}
const scratch = () => mkdtempSync(join(tmpdir(), 'locust-publish-downloads-'))
async function fetchText(key) {
  const answer = await fetch(`${DOWNLOADS}${key}?check=${String(Date.now())}`).catch(() => undefined)
  return answer?.ok === true ? answer.text() : undefined
}

if (macDir !== undefined) {
  // The two disk images, then a small file naming them with their sizes and hashes, which --promote reads.
  const images = readdirSync(macDir).filter((name) => name === `Locust-${version}-mac-arm64.dmg` || name === `Locust-${version}-mac-x64.dmg`)
  if (images.length !== 2) fail(`${macDir} must hold Locust-${version}-mac-arm64.dmg and -mac-x64.dmg; it holds ${images.join(', ') || 'neither'}`)
  const assets = []
  for (const name of images.sort()) {
    const file = join(macDir, name)
    await upload(name, file)
    assets.push({ name, browser_download_url: `${DOWNLOADS}${name}`, size: statSync(file).size, digest: `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}` })
  }
  const sidecar = join(scratch(), `Locust-${version}-mac.json`)
  writeFileSync(sidecar, `${JSON.stringify({ tag_name: version, draft: false, prerelease: false, assets }, null, 2)}\n`)
  await upload(`Locust-${version}-mac.json`, sidecar)
  say(`${version}: the Mac images are up. Macs see them when ${version} is promoted.`)
} else if (!promote) {
  const installer = `Locust-${version}-setup.exe`
  for (const name of [installer, `${installer}.blockmap`, 'latest.yml']) {
    if (!existsSync(join(RELEASE, name))) fail(`${name} is not in ${RELEASE} -- build it with _tools/ship.mjs first`)
  }
  // latest.yml must name this version's installer, with the hash of the file that is about to go up.
  const feed = readFileSync(join(RELEASE, 'latest.yml'), 'utf8')
  if (!feed.includes(`version: ${version}`) || !feed.includes(`path: ${installer}`)) fail(`latest.yml is not for ${version}:\n${feed}`)
  const sha512 = createHash('sha512').update(readFileSync(join(RELEASE, installer))).digest('base64')
  if (!feed.includes(`sha512: ${sha512}`)) fail("latest.yml's sha512 is not the installer on disk")
  await upload(`${installer}.blockmap`, join(RELEASE, `${installer}.blockmap`))
  await upload(installer, join(RELEASE, installer))
  // This version's feed file, kept by name so --promote can hand it to the tester lane later.
  await upload(`Locust-${version}.yml`, join(RELEASE, 'latest.yml'))
  await upload('beta.yml', join(RELEASE, 'latest.yml'), { fresh: true })
  say(`${version} is out on every build. Promote it for testers with --promote.`)
} else {
  const installer = `Locust-${version}-setup.exe`
  const feed = await fetchText(`Locust-${version}.yml`)
  if (feed === undefined || !feed.includes(`version: ${version}`)) fail(`Locust-${version}.yml is not on ${DOWNLOADS}: publish ${version} first`)
  const local = join(RELEASE, installer)
  if (!existsSync(local)) fail(`${installer} is not in ${RELEASE}; the site's Locust-Setup.exe is uploaded from it`)
  const dir = scratch()
  writeFileSync(join(dir, 'latest.yml'), feed)
  await upload('Locust-Setup.exe', local, { fresh: true })
  // The Mac release list, newest first, in the shape GitHub's releases API answered in (src/main/mac-release.ts).
  const mac = await fetchText(`Locust-${version}-mac.json`)
  if (mac === undefined) {
    say(`  no Mac images for ${version} yet: the Mac list is left as it is`)
  } else {
    const before = JSON.parse((await fetchText('mac-releases.json')) ?? '[]')
    const list = [JSON.parse(mac), ...before.filter((entry) => entry.tag_name !== version)].slice(0, 10)
    writeFileSync(join(dir, 'mac-releases.json'), `${JSON.stringify(list, null, 2)}\n`)
    await upload('mac-releases.json', join(dir, 'mac-releases.json'), { fresh: true })
  }
  await upload('latest.yml', join(dir, 'latest.yml'), { fresh: true })
  say(`${version} is the tester lane's now.`)
}
