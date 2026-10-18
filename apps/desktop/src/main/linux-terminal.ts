import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { join, posix } from 'node:path'

/**
 * A LINUX TERMINAL (0.789). Linux has no one terminal the way a Mac has
 * Terminal: GNOME ships Ptyxis or GNOME Terminal, KDE Konsole, Xfce its own,
 * and many people choose another and say so in $TERMINAL. So the one asked
 * for wins, then the desktop's own, then Debian's x-terminal-emulator, then
 * any other that is installed -- the order VS Code's external terminal takes.
 *
 * Each is handed one argument it runs, a script Locust writes, never a
 * command line it would have to split: the script goes to the folder, sets
 * the environment the launch needs, removes itself and runs the program,
 * every word single-quoted, so a path with a space or a quote arrives as it
 * is. A program that fails keeps its window open until Enter, so its error
 * can be read; a Linux terminal otherwise closes the moment it ends.
 */
export interface LinuxTerminal {
  /** The program, as found on PATH. */
  readonly command: string
  /** What the person calls it: "Opened in Konsole". */
  readonly name: string
  /** The arguments that run `script` in a new window, starting in `cwd`. */
  readonly args: readonly string[]
}

type Known = { readonly name: string; readonly args: (script: string, cwd: string) => readonly string[] }

const KNOWN: Readonly<Record<string, Known>> = {
  ptyxis: { name: 'Ptyxis', args: (script, cwd) => ['--new-window', `--working-directory=${cwd}`, '--', script] },
  'gnome-terminal': { name: 'GNOME Terminal', args: (script, cwd) => [`--working-directory=${cwd}`, '--', script] },
  kgx: { name: 'Console', args: (script, cwd) => [`--working-directory=${cwd}`, '--', script] },
  konsole: { name: 'Konsole', args: (script, cwd) => ['--workdir', cwd, '-e', script] },
  'xfce4-terminal': { name: 'Xfce Terminal', args: (script, cwd) => [`--working-directory=${cwd}`, '-x', script] },
  'mate-terminal': { name: 'MATE Terminal', args: (script, cwd) => [`--working-directory=${cwd}`, '-x', script] },
  tilix: { name: 'Tilix', args: (script, cwd) => ['-w', cwd, '-e', script] },
  terminator: { name: 'Terminator', args: (script, cwd) => [`--working-directory=${cwd}`, '-x', script] },
  kitty: { name: 'kitty', args: (script, cwd) => ['--directory', cwd, script] },
  alacritty: { name: 'Alacritty', args: (script, cwd) => ['--working-directory', cwd, '-e', script] },
  wezterm: { name: 'WezTerm', args: (script, cwd) => ['start', '--cwd', cwd, '--', script] },
  foot: { name: 'foot', args: (script, cwd) => [`--working-directory=${cwd}`, script] },
  'x-terminal-emulator': { name: 'the terminal', args: (script) => ['-e', script] },
  xterm: { name: 'xterm', args: (script) => ['-e', script] }
}

/** Each desktop's own terminal, newest first, by the names in XDG_CURRENT_DESKTOP. */
const BY_DESKTOP: readonly (readonly [RegExp, readonly string[]])[] = [
  [/^(gnome|ubuntu|unity|pop|budgie)$/i, ['ptyxis', 'gnome-terminal', 'kgx']],
  [/^kde$/i, ['konsole']],
  [/^xfce$/i, ['xfce4-terminal']],
  [/^mate$/i, ['mate-terminal']],
  [/^(x-cinnamon|cinnamon)$/i, ['gnome-terminal']]
]
const ANY_OTHER = ['gnome-terminal', 'ptyxis', 'kgx', 'konsole', 'xfce4-terminal', 'mate-terminal', 'tilix', 'terminator', 'kitty', 'alacritty', 'wezterm', 'foot', 'xterm']

/** The first executable called `name` on PATH, or undefined. */
export function onPath(name: string, path: string | undefined, isExecutable: (file: string) => boolean = executable): string | undefined {
  if (name.includes('/')) return isExecutable(name) ? name : undefined
  for (const directory of (path ?? '').split(':')) {
    if (directory.length === 0) continue
    const file = posix.join(directory, name)
    if (isExecutable(file)) return file
  }
  return undefined
}

function executable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The terminals to try, in order, each with the arguments that run `script` in `cwd`. */
export function linuxTerminals(
  script: string,
  cwd: string,
  /** $TERMINAL, $XDG_CURRENT_DESKTOP and $PATH are read. */
  env: Readonly<Record<string, string | undefined>>,
  isExecutable: (file: string) => boolean = executable
): readonly LinuxTerminal[] {
  const names: string[] = []
  const chosen = env.TERMINAL?.trim()
  const desktops = (env.XDG_CURRENT_DESKTOP ?? '').split(':').map((one) => one.trim()).filter(Boolean)
  for (const desktop of desktops) {
    for (const [pattern, own] of BY_DESKTOP) if (pattern.test(desktop)) names.push(...own)
  }
  names.push('x-terminal-emulator', ...ANY_OTHER)
  const out: LinuxTerminal[] = []
  const seen = new Set<string>()
  if (chosen !== undefined && chosen.length > 0) {
    const command = onPath(chosen, env.PATH, isExecutable)
    if (command !== undefined) {
      const known = KNOWN[posix.basename(chosen)]
      // A terminal Locust does not know by name is asked the way nearly every one understands: -e.
      out.push({ command, name: known?.name ?? posix.basename(chosen), args: known?.args(script, cwd) ?? ['-e', script] })
      seen.add(command)
    }
  }
  for (const name of names) {
    const command = onPath(name, env.PATH, isExecutable)
    if (command === undefined || seen.has(command)) continue
    seen.add(command)
    out.push({ command, name: KNOWN[name]!.name, args: KNOWN[name]!.args(script, cwd) })
  }
  return out
}

/** The script a Linux terminal runs: the folder, the environment, then the program. */
export function linuxTerminalScript(program: { readonly file: string; readonly args: readonly string[] }, cwd: string, env?: Readonly<Record<string, string>>): string {
  const quoted = (value: string): string => `'${value.split("'").join(`'"'"'`)}'`
  return [
    '#!/bin/sh',
    'rm -f -- "$0"',
    `cd ${quoted(cwd)} || exit 1`,
    ...Object.entries(env ?? {}).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)).map(([name, value]) => `export ${name}=${quoted(value)}`),
    [program.file, ...program.args].map(quoted).join(' '),
    'status=$?',
    'if [ "$status" -ne 0 ]; then',
    `  printf '\\n%s' 'It ended with an error. Press Enter to close this window.'`,
    '  read -r _',
    'fi',
    'exit "$status"',
    ''
  ].join('\n')
}

export type LinuxTerminalResult = { readonly ok: true; readonly where: string } | { readonly ok: false; readonly message: string }

/** Long enough for a terminal that refuses its arguments to exit and say so; a window that opened stays. */
const SETTLE_MS = 1_500

/**
 * Opens `program` in a new terminal window in `cwd`. PATH travels with it: a
 * GNOME Terminal window is started by its server, not by Locust, and would
 * otherwise have the session's PATH instead of the one Locust found the
 * program on (shell-path.ts).
 */
export async function openInLinuxTerminal(
  cwd: string,
  program: { readonly file: string; readonly args: readonly string[] },
  env: Readonly<Record<string, string>> | undefined,
  run: typeof spawn = spawn,
  options: { readonly environment?: NodeJS.ProcessEnv; readonly isExecutable?: (file: string) => boolean; readonly settleMs?: number } = {}
): Promise<LinuxTerminalResult> {
  const { chmod, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { randomUUID } = await import('node:crypto')
  const environment = options.environment ?? process.env
  const script = join(tmpdir(), `locust-terminal-${randomUUID()}.sh`)
  const carried = { ...(environment.PATH === undefined ? {} : { PATH: environment.PATH }), ...(env ?? {}) }
  const terminals = linuxTerminals(script, cwd, environment, options.isExecutable)
  if (terminals.length === 0) {
    return { ok: false, message: 'No terminal app was found on this computer. Install one, such as GNOME Terminal, Konsole or xterm, and try again.' }
  }
  try {
    await writeFile(script, linuxTerminalScript(program, cwd, carried), 'utf8')
    await chmod(script, 0o700)
  } catch (error) {
    return { ok: false, message: `The terminal could not be opened (${error instanceof Error ? error.message : String(error)}). The conversation is here, as it was.` }
  }
  let last = ''
  for (const terminal of terminals) {
    const outcome = await new Promise<true | string>((resolve) => {
      let child: ReturnType<typeof spawn>
      try {
        // The launch's own variables go in the script, not to the terminal: ELECTRON_RUN_AS_NODE, there, would
        // turn a terminal that is itself an Electron app into a bare Node.
        child = run(terminal.command, [...terminal.args], { cwd, detached: true, stdio: 'ignore', env: environment })
      } catch (error) {
        resolve(error instanceof Error ? error.message : String(error))
        return
      }
      const timer = setTimeout(() => resolve(true), options.settleMs ?? SETTLE_MS)
      child.once('error', (error) => {
        clearTimeout(timer)
        resolve(error.message)
      })
      // A launcher that hands the window to a server (GNOME Terminal) exits 0 at once; one that refused exits non-zero.
      child.once('exit', (code) => {
        clearTimeout(timer)
        resolve(code === 0 || code === null ? true : `${terminal.name} exited with ${String(code)}`)
      })
      child.unref()
    })
    if (outcome === true) return { ok: true, where: terminal.name }
    last = outcome
  }
  await rm(script, { force: true }).catch(() => undefined)
  return { ok: false, message: `The terminal could not be opened (${last}). The conversation is here, as it was.` }
}
