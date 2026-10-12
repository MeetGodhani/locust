/*
 * TALK FROM ANYWHERE (0.755). Colin passed it on 2026-10-12 ("I'll run all your suggestions"), from Grok Bot's voice
 * mode, where the phone's action button starts a call: a key press, in any app, brings Locust up and presses its Talk
 * button -- a call with the teammate whose conversation is on screen, or ChatGPT's own voice on Home -- and the same
 * press ends the call. Windows gives a shortcut to one app at a time, so Settings says when another app holds these
 * keys, and they can be changed or turned off there.
 */

export const TALK_SHORTCUT_READ = 'talk-shortcut:read'
export const TALK_SHORTCUT_SET = 'talk-shortcut:set'
/** Main to the window: the keys were pressed. */
export const TALK_SHORTCUT_PRESSED = 'talk-shortcut:pressed'
/** A press made before the window could hear it -- Locust started in the tray -- taken once. */
export const TALK_SHORTCUT_PENDING = 'talk-shortcut:pending'

/** Ctrl+Alt+Space: nothing of Windows' own, and neither Ctrl+Space nor Alt+Space, which input methods and launchers take. */
export const DEFAULT_TALK_SHORTCUT = 'Ctrl+Alt+Space'

export interface TalkShortcutState {
  /** The keys, as Electron's accelerator; absent when the shortcut is off. */
  readonly keys?: string
  /** Windows gave the keys to Locust, so a press reaches it from any app. */
  readonly working: boolean
  /** Why it is not working, in a person's words; absent when it is, or is off. */
  readonly why?: string
}

export interface TalkShortcutPress {
  /** Talk cannot start, and why: said on screen instead of a call that would fail. */
  readonly why?: string
}

export interface TalkShortcutApi {
  read(): Promise<TalkShortcutState>
  /** New keys, or false to turn it off. */
  set(keys: string | false): Promise<TalkShortcutState>
  onPressed(listener: (press: TalkShortcutPress) => void): () => void
  pending(): Promise<TalkShortcutPress | undefined>
}

const KEY = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/

/**
 * Keys a shortcut may be: Ctrl or Alt (or both), Shift if wanted, then one letter, digit, F-key or Space. Without
 * Ctrl or Alt it would take a key the person types; the Windows key is left to Windows, which keeps most of its own.
 */
export function isTalkShortcut(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false
  const parts = value.split('+')
  const key = parts.pop() ?? ''
  if (!KEY.test(key)) return false
  const order = ['Ctrl', 'Alt', 'Shift']
  let at = 0
  for (const part of parts) {
    const found = order.indexOf(part, at)
    if (found < 0) return false
    at = found + 1
  }
  return parts.includes('Ctrl') || parts.includes('Alt')
}

/** The shortcut a key press makes, in Ctrl, Alt, Shift order; undefined while only modifiers are down, or for keys it may not be. */
export function shortcutFromPress(press: { readonly code: string; readonly ctrlKey: boolean; readonly altKey: boolean; readonly shiftKey: boolean; readonly metaKey: boolean }): string | undefined {
  if (press.metaKey) return undefined
  const key = /^Key([A-Z])$/.exec(press.code)?.[1] ?? /^Digit([0-9])$/.exec(press.code)?.[1] ?? (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(press.code) || press.code === 'Space' ? press.code : undefined)
  if (key === undefined) return undefined
  const keys = [...(press.ctrlKey ? ['Ctrl'] : []), ...(press.altKey ? ['Alt'] : []), ...(press.shiftKey ? ['Shift'] : []), key].join('+')
  return isTalkShortcut(keys) ? keys : undefined
}
