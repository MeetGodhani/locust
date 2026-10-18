/**
 * The person's theme (0.789, main/appearance.ts): Dark, Light, or Match the computer.
 */
export type ThemeChoice = 'dark' | 'light' | 'system'

/** What the window is drawn in now: the choice, and what Match the computer comes to. */
export interface AppearanceState {
  readonly theme: ThemeChoice
  readonly resolved: 'dark' | 'light'
}

export const APPEARANCE_GET_CHANNEL = 'appearance:get'
export const APPEARANCE_SET_CHANNEL = 'appearance:set'
/** Sent to every window when the theme changes -- by the person, or by the computer under Match the computer. */
export const APPEARANCE_CHANGED_CHANNEL = 'appearance:changed'
/**
 * Handed to each window's preload on its command line, so the page is in the right theme from its first frame
 * rather than one IPC round trip after it.
 */
export const THEME_ARGUMENT = '--locust-theme='

/** The theme a window was started in, from its own command line; dark when it says nothing readable. */
export function themeFromArguments(argv: readonly string[]): 'dark' | 'light' {
  const given = argv.find((arg) => arg.startsWith(THEME_ARGUMENT))?.slice(THEME_ARGUMENT.length)
  return given === 'light' ? 'light' : 'dark'
}
