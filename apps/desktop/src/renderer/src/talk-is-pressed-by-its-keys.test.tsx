import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { TalkShortcutSetting } from './components/TalkShortcutSetting.js'
import { clearTalkPress, pressTalk, setTalkPress } from './talkPress.js'

/*
 * TALK IS PRESSED BY ITS KEYS (0.755, shared/talk-shortcut.ts). The chat box's Talk button, while it is on screen and
 * Talk is ready, is the one the shortcut presses -- a call starts, or the one that is on ends. With none on screen
 * (Settings was open, or the window is still opening) the press waits a few seconds for the one the window goes back
 * to, and no longer: a press from a minute ago never starts a call.
 */
describe('the press', () => {
  it('goes to the button on screen', () => {
    const button = vi.fn()
    setTalkPress(button)
    expect(pressTalk()).toBe(true)
    expect(button).toHaveBeenCalledTimes(1)
    clearTalkPress(button)
    expect(pressTalk(0)).toBe(false)
    expect(button).toHaveBeenCalledTimes(1)
    // A button long after the press does not take it.
    const later = vi.fn()
    setTalkPress(later, 999_999)
    expect(later).not.toHaveBeenCalled()
    clearTalkPress(later)
  })

  it('waits a few seconds for a button, then is forgotten', () => {
    expect(pressTalk(1_000)).toBe(false)
    const soon = vi.fn()
    setTalkPress(soon, 9_000)
    expect(soon).toHaveBeenCalledTimes(1)
    clearTalkPress(soon)
    expect(pressTalk(20_000)).toBe(false)
    const late = vi.fn()
    setTalkPress(late, 40_000)
    expect(late).not.toHaveBeenCalled()
    // Taken once: the next button that comes is not pressed again.
    const next = vi.fn()
    setTalkPress(next, 40_001)
    expect(next).not.toHaveBeenCalled()
    clearTalkPress(next)
  })

  it('is cleared only by the button that set it, so a newer one that came first stays', () => {
    const older = vi.fn()
    const newer = vi.fn()
    setTalkPress(older)
    setTalkPress(newer)
    clearTalkPress(older)
    pressTalk()
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
    clearTalkPress(newer)
  })
})

describe('the setting', () => {
  const api = { read: vi.fn(async () => ({ working: false })), set: vi.fn(), onPressed: vi.fn(() => () => undefined), pending: vi.fn(async () => undefined) }
  it('is on Windows only, where Talk is', () => {
    expect(renderToStaticMarkup(createElement(TalkShortcutSetting, { heading: 'Talk from any app', api, platform: 'darwin' }))).toBe('')
    const html = renderToStaticMarkup(createElement(TalkShortcutSetting, { heading: 'Talk from any app', api, platform: 'win32' }))
    expect(html).toContain('Talk from any app')
    expect(html).toContain('role="switch"')
    // Read before it says anything: the switch waits for the keys.
    expect(html).toContain('disabled=""')
  })
})
