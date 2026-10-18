import { EventEmitter } from 'node:events'
import { readFileSync, rmSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { linuxTerminalScript, linuxTerminals, onPath, openInLinuxTerminal } from './linux-terminal.js'

/**
 * A LINUX TERMINAL IS THE ONE THE DESKTOP HAS (0.789). Signing in to Claude
 * Code or Codex, continuing a conversation in a terminal, and the cloud
 * computer's shell all open a terminal window; on Linux there is no one
 * terminal, so the one the person asked for wins, then the desktop's own,
 * then Debian's x-terminal-emulator, then any other installed.
 */
const installed = (...names: string[]) => (file: string): boolean => names.some((name) => file === `/usr/bin/${name}`)
const ENV = { PATH: '/usr/local/bin:/usr/bin' }

describe('which terminal Locust opens on Linux', () => {
  it("takes the desktop's own first: Ptyxis, then GNOME Terminal, on GNOME", () => {
    const found = linuxTerminals('/tmp/run.sh', '/home/ian/pebble', { ...ENV, XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, installed('xterm', 'gnome-terminal', 'ptyxis'))
    expect(found.map((one) => one.name)).toEqual(['Ptyxis', 'GNOME Terminal', 'xterm'])
    expect(found[1]).toEqual({ command: '/usr/bin/gnome-terminal', name: 'GNOME Terminal', args: ['--working-directory=/home/ian/pebble', '--', '/tmp/run.sh'] })
  })

  it('takes Konsole on KDE, and the one $TERMINAL names before any', () => {
    expect(linuxTerminals('/tmp/run.sh', '/w', { ...ENV, XDG_CURRENT_DESKTOP: 'KDE' }, installed('gnome-terminal', 'konsole'))[0]).toEqual({ command: '/usr/bin/konsole', name: 'Konsole', args: ['--workdir', '/w', '-e', '/tmp/run.sh'] })
    const chosen = linuxTerminals('/tmp/run.sh', '/w', { ...ENV, XDG_CURRENT_DESKTOP: 'KDE', TERMINAL: 'kitty' }, installed('konsole', 'kitty'))
    expect(chosen.map((one) => one.name)).toEqual(['kitty', 'Konsole'])
    expect(chosen[0]!.args).toEqual(['--directory', '/w', '/tmp/run.sh'])
  })

  it('asks a terminal it does not know by name the way nearly every one understands, with -e', () => {
    const [chosen] = linuxTerminals('/tmp/run.sh', '/w', { ...ENV, TERMINAL: '/opt/zed-term/bin/zterm' }, (file) => file === '/opt/zed-term/bin/zterm')
    expect(chosen).toEqual({ command: '/opt/zed-term/bin/zterm', name: 'zterm', args: ['-e', '/tmp/run.sh'] })
  })

  it("falls back to Debian's x-terminal-emulator, and lists each terminal once", () => {
    const found = linuxTerminals('/tmp/run.sh', '/w', { ...ENV, XDG_CURRENT_DESKTOP: 'Hyprland' }, installed('x-terminal-emulator', 'xterm'))
    expect(found.map((one) => one.command)).toEqual(['/usr/bin/x-terminal-emulator', '/usr/bin/xterm'])
  })

  it('finds nothing when no terminal is installed, and finds a command on PATH in order', () => {
    expect(linuxTerminals('/tmp/run.sh', '/w', ENV, () => false)).toEqual([])
    expect(onPath('xterm', '/a::/b', (file) => file === '/b/xterm' || file === '/c/xterm')).toBe('/b/xterm')
  })
})

describe('the script a Linux terminal runs', () => {
  it('goes to the folder, sets the environment, quotes every word, and keeps a failure on screen', () => {
    const script = linuxTerminalScript({ file: "/home/ian/it's/claude", args: ['--resume', 'a b'] }, '/home/ian/my project', { ELECTRON_RUN_AS_NODE: '1', 'BAD NAME': 'x' })
    expect(script.split('\n')).toEqual([
      '#!/bin/sh',
      'rm -f -- "$0"',
      "cd '/home/ian/my project' || exit 1",
      "export ELECTRON_RUN_AS_NODE='1'",
      `'/home/ian/it'"'"'s/claude' '--resume' 'a b'`,
      'status=$?',
      'if [ "$status" -ne 0 ]; then',
      "  printf '\\n%s' 'It ended with an error. Press Enter to close this window.'",
      '  read -r _',
      'fi',
      'exit "$status"',
      ''
    ])
  })
})

describe('opening a Linux terminal', () => {
  type Spawned = EventEmitter & { unref: () => void }
  const fakeRun = (outcomes: readonly ('stays' | 'exits0' | 'exits1' | 'missing')[]) => {
    const calls: { command: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
    const run = vi.fn((command: string, args: readonly string[], options: { env: NodeJS.ProcessEnv }) => {
      const outcome = outcomes[calls.length] ?? 'stays'
      calls.push({ command, args, env: options.env })
      const child = Object.assign(new EventEmitter(), { unref: () => undefined }) as Spawned
      queueMicrotask(() => {
        if (outcome === 'missing') child.emit('error', new Error('spawn ENOENT'))
        if (outcome === 'exits0') child.emit('exit', 0)
        if (outcome === 'exits1') child.emit('exit', 1)
      })
      return child
    })
    return { run, calls }
  }
  const environment = { PATH: '/usr/bin', XDG_CURRENT_DESKTOP: 'GNOME' }

  it('says where it opened, and carries PATH and the launch environment in the script, not to the terminal', async () => {
    const fake = fakeRun(['exits0'])
    const opened = await openInLinuxTerminal('/home/ian/pebble', { file: '/usr/bin/codex', args: ['resume', 's1'] }, { ELECTRON_RUN_AS_NODE: '1' }, fake.run as never, { environment, isExecutable: installed('gnome-terminal'), settleMs: 20 })
    expect(opened).toEqual({ ok: true, where: 'GNOME Terminal' })
    expect(fake.calls[0]!.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    const script = fake.calls[0]!.args.at(-1)!
    expect(readFileSync(script, 'utf8')).toContain("export PATH='/usr/bin'")
    expect(readFileSync(script, 'utf8')).toContain("export ELECTRON_RUN_AS_NODE='1'")
    rmSync(script, { force: true })
  })

  it('tries the next terminal when one refuses its arguments or is missing', async () => {
    const fake = fakeRun(['exits1', 'missing', 'stays'])
    const opened = await openInLinuxTerminal('/w', { file: '/usr/bin/claude', args: [] }, undefined, fake.run as never, { environment, isExecutable: installed('ptyxis', 'gnome-terminal', 'xterm'), settleMs: 20 })
    expect(opened).toEqual({ ok: true, where: 'xterm' })
    expect(fake.calls.map((call) => call.command)).toEqual(['/usr/bin/ptyxis', '/usr/bin/gnome-terminal', '/usr/bin/xterm'])
    rmSync(fake.calls[2]!.args.at(-1)!, { force: true })
  })

  it('says how to fix it when no terminal is installed, and starts nothing', async () => {
    const fake = fakeRun([])
    const opened = await openInLinuxTerminal('/w', { file: '/usr/bin/claude', args: [] }, undefined, fake.run as never, { environment, isExecutable: () => false })
    expect(opened).toEqual({ ok: false, message: 'No terminal app was found on this computer. Install one, such as GNOME Terminal, Konsole or xterm, and try again.' })
    expect(fake.calls).toHaveLength(0)
  })
})
