import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import type { AppearanceState, ThemeChoice } from '../../../shared/appearance.js'

/**
 * Dark, Light, or Match the computer (0.789, main/appearance.ts). Dark is the default, so nobody's Locust changes
 * under them; the window repaints at once, and every other window with it.
 */
const CHOICES: readonly (readonly [ThemeChoice, string])[] = [
  ['dark', 'Dark'],
  ['light', 'Light'],
  ['system', 'Match computer']
]

export function themeLede(theme: ThemeChoice, resolved: 'dark' | 'light' | undefined): string {
  if (theme === 'light') return 'Light. For a bright room, or a desktop that is light.'
  if (theme === 'system') return `Matches your computer, and changes when it does. It is ${resolved ?? 'dark'} now.`
  return 'Dark. Locust as it was first drawn.'
}

export function ThemeSetting(): ReactElement {
  const [state, setState] = useState<AppearanceState>()
  useEffect(() => {
    let live = true
    void window.desktop?.readAppearance().then((next) => {
      if (live) setState(next)
    })
    // Changed in another window, or by the computer under Match computer.
    const stop = window.desktop?.onAppearance((next) => setState(next))
    return () => {
      live = false
      stop?.()
    }
  }, [])
  const theme = state?.theme ?? 'dark'
  return (
    <div className="lc-settingline">
      <div className="lc-settingline__text">
        <h2 className="lc-settings__heading">Theme</h2>
        <p className="lc-settings__lede">{themeLede(theme, state?.resolved)}</p>
      </div>
      <div className="lc-segmented" role="radiogroup" aria-label="Which theme Locust is drawn in">
        {CHOICES.map(([option, label]) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={theme === option}
            className={`lc-button${theme === option ? ' is-active' : ''}`}
            onClick={() => {
              void window.desktop?.setTheme(option).then(setState)
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
