import { describe, expect, it } from 'vitest'

import { shellPath } from './shell-path.js'

/**
 * A LINUX APP SEES THE TERMINAL'S PATH (0.789). Opened from the app grid, a
 * Linux app gets the session's PATH, which ~/.profile builds -- not what
 * ~/.bashrc adds, which is where nvm puts node and every CLI npm installed
 * under it. Locust asks the login shell, as it does on a Mac.
 */
describe('the PATH Locust runs with on Linux', () => {
  it("puts the login shell's PATH first, then what it was given, then the usual Linux install folders", () => {
    const path = shellPath('linux', '/usr/bin:/bin', { shell: '/usr/bin/zsh', home: '/home/ian', ask: () => '/home/ian/.nvm/versions/node/v24.1.0/bin:/usr/bin' })
    const parts = path!.split(':')
    expect(parts.slice(0, 3)).toEqual(['/home/ian/.nvm/versions/node/v24.1.0/bin', '/usr/bin', '/bin'])
    expect(parts).toContain('/home/ian/.local/bin')
    expect(parts).toContain('/home/ian/.opencode/bin')
    expect(parts).toContain('/home/linuxbrew/.linuxbrew/bin')
    expect(parts).not.toContain('/opt/homebrew/bin')
    expect(new Set(parts).size).toBe(parts.length)
  })

  it('asks bash when the session names no shell, and zsh on a Mac', () => {
    const asked: (string | undefined)[] = []
    const ask = (shell: string | undefined, _run?: unknown, fallback?: string): string => {
      asked.push(shell ?? fallback)
      return '/usr/bin'
    }
    shellPath('linux', '/usr/bin', { home: '/home/ian', ask: ask as never })
    shellPath('darwin', '/usr/bin', { home: '/Users/ian', ask: ask as never })
    expect(asked).toEqual(['/bin/bash', '/bin/zsh'])
  })

  it('still finds the usual folders when the shell cannot be asked', () => {
    const path = shellPath('linux', '/usr/bin:/bin', { home: '/home/ian', ask: () => undefined })
    expect(path!.startsWith('/usr/bin:/bin:')).toBe(true)
    expect(path).toContain('/home/ian/.local/bin')
  })
})
