import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_TALK_SHORTCUT, isTalkShortcut, shortcutFromPress } from '../shared/talk-shortcut.js'
import { createTalkShortcut, type TalkShortcutDeps } from './talk-shortcut.js'

/*
 * TALK STARTS FROM ANY APP (0.755). Colin passed it on 2026-10-12, from Grok Bot's voice mode, where the phone's action
 * button starts a call: Ctrl+Alt+Space, in any app, brings Locust up and presses Talk. Windows gives a shortcut to one
 * app at a time, so the keys are taken only once Talk could start -- a machine without Talk keeps them -- Settings
 * says when another app holds them, and they can be changed or turned off. A test drive's window leaves the person's
 * keys alone.
 */
const press = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

describe('the keys a shortcut may be', () => {
  it('are Ctrl or Alt, Shift if wanted, then a letter, digit, F-key or Space', () => {
    for (const keys of ['Ctrl+Alt+Space', 'Ctrl+T', 'Alt+Shift+F9', 'Ctrl+Alt+Shift+7', 'Alt+F24']) expect(isTalkShortcut(keys)).toBe(true)
    // Without Ctrl or Alt it would take a key the person types; the Windows key is left to Windows.
    for (const keys of ['Space', 'Shift+A', 'Super+Space', 'Ctrl+Alt', 'Alt+Ctrl+Space', 'Ctrl+Ctrl+A', 'Ctrl+Enter', 'Ctrl+F25', 'Ctrl+a', '', 'Ctrl+Alt+Space+X', 42])
      expect(isTalkShortcut(keys)).toBe(false)
  })

  it('come from a key press in Ctrl, Alt, Shift order, and not while only modifiers are down', () => {
    expect(shortcutFromPress(press('Space', { ctrlKey: true, altKey: true }))).toBe(DEFAULT_TALK_SHORTCUT)
    expect(shortcutFromPress(press('KeyT', { shiftKey: true, altKey: true }))).toBe('Alt+Shift+T')
    expect(shortcutFromPress(press('Digit5', { ctrlKey: true }))).toBe('Ctrl+5')
    expect(shortcutFromPress(press('F9', { altKey: true }))).toBe('Alt+F9')
    expect(shortcutFromPress(press('ControlLeft', { ctrlKey: true }))).toBeUndefined()
    expect(shortcutFromPress(press('KeyT'))).toBeUndefined()
    expect(shortcutFromPress(press('KeyT', { ctrlKey: true, metaKey: true }))).toBeUndefined()
    expect(shortcutFromPress(press('Enter', { ctrlKey: true }))).toBeUndefined()
  })
})

const harness = (overrides: Partial<TalkShortcutDeps> = {}) => {
  let kept: unknown
  const held = new Set<string>()
  const taken = new Set<string>()
  const deps: TalkShortcutDeps = {
    register: vi.fn((keys: string) => { if (taken.has(keys)) return false; held.add(keys); return true }),
    unregister: vi.fn((keys: string) => { held.delete(keys) }),
    read: async () => kept,
    write: async (keys) => { kept = keys },
    pressed: vi.fn(),
    ready: async () => true,
    ...overrides
  }
  return { deps, held, taken, shortcut: createTalkShortcut(deps), kept: () => kept, keep: (value: unknown) => { kept = value } }
}

describe('the keys, taken from Windows', () => {
  it('are Ctrl+Alt+Space until the person chooses others, taken once Talk could start', async () => {
    let ready = false
    const { shortcut, held } = harness({ ready: async () => ready })
    await shortcut.ensure()
    expect(held.size).toBe(0)
    expect(await shortcut.read()).toEqual({ keys: 'Ctrl+Alt+Space', working: false, why: expect.stringContaining('once Talk is ready') })
    ready = true
    await shortcut.ensure()
    expect([...held]).toEqual(['Ctrl+Alt+Space'])
    expect(await shortcut.read()).toEqual({ keys: 'Ctrl+Alt+Space', working: true })
  })

  it('say so when another app holds them, and are tried again at the next check', async () => {
    const { shortcut, taken, held } = harness()
    taken.add('Ctrl+Alt+Space')
    await shortcut.ensure()
    expect(await shortcut.read()).toEqual({ keys: 'Ctrl+Alt+Space', working: false, why: 'Another app is using Ctrl+Alt+Space, so Windows will not give it to Locust. Choose other keys.' })
    taken.delete('Ctrl+Alt+Space')
    await shortcut.ensure()
    expect([...held]).toEqual(['Ctrl+Alt+Space'])
  })

  it('change to the person’s own at once, the old ones given back, and stay off once turned off', async () => {
    const { shortcut, held, kept } = harness({ ready: async () => false })
    expect(await shortcut.set('Alt+Shift+T')).toEqual({ keys: 'Alt+Shift+T', working: true })
    expect(kept()).toBe('Alt+Shift+T')
    expect([...held]).toEqual(['Alt+Shift+T'])
    expect(await shortcut.set(false)).toEqual({ working: false })
    expect(held.size).toBe(0)
    expect(kept()).toBe(false)
    await shortcut.ensure()
    expect(held.size).toBe(0)
    // Nonsense changes nothing.
    expect(await shortcut.set('Space')).toEqual({ working: false })
    expect(kept()).toBe(false)
  })

  it('read the kept keys, and the default for anything a person could not have chosen', async () => {
    const { shortcut, keep } = harness()
    keep('Ctrl+Alt+Shift+F2')
    expect((await shortcut.read()).keys).toBe('Ctrl+Alt+Shift+F2')
    keep('rm -rf')
    expect((await shortcut.read()).keys).toBe(DEFAULT_TALK_SHORTCUT)
  })

  it('press Talk through the window when Windows hears them', async () => {
    const { shortcut, deps } = harness()
    await shortcut.ensure()
    const onPress = vi.mocked(deps.register).mock.calls[0]![1]
    onPress()
    expect(deps.pressed).toHaveBeenCalledTimes(1)
  })

  it('are given back when Locust quits', async () => {
    const { shortcut, held } = harness()
    await shortcut.ensure()
    shortcut.dispose()
    expect(held.size).toBe(0)
  })

  it('are none of the person’s in a test drive’s window, which takes only keys it names', async () => {
    const drive = harness({ refusedHere: 'A window a test drive opened leaves your keys alone.' })
    await drive.shortcut.ensure()
    expect(drive.held.size).toBe(0)
    expect(await drive.shortcut.set('Ctrl+Alt+Space')).toEqual({ keys: 'Ctrl+Alt+Space', working: false, why: 'A window a test drive opened leaves your keys alone.' })
    expect(drive.held.size).toBe(0)
    const named = harness({ refusedHere: 'A window a test drive opened leaves your keys alone.', keysHere: 'Ctrl+Alt+Shift+F11' })
    named.keep('Ctrl+Alt+Space')
    await named.shortcut.ensure()
    expect([...named.held]).toEqual(['Ctrl+Alt+Shift+F11'])
    // Settings cannot move a drive's keys onto the person's.
    expect(await named.shortcut.set('Ctrl+Alt+Space')).toEqual({ keys: 'Ctrl+Alt+Shift+F11', working: true })
    expect([...named.held]).toEqual(['Ctrl+Alt+Shift+F11'])
  })
})
