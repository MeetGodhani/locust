import { useEffect, useState } from 'react'

import type { ScoutState } from '../../shared/scout.js'

/*
 * SCOUT, AS THE WINDOW KNOWS IT (0.756, shared/scout.ts): its settings, its cards and its looks' turns, read once and
 * then told each time they change. Undefined until the first read answers, and where there is no Scout to ask.
 */
export function useScoutState(api = typeof window === 'undefined' ? undefined : window.desktop?.scout): ScoutState | undefined {
  const [state, setState] = useState<ScoutState>()
  useEffect(() => {
    if (api === undefined) return
    let alive = true
    const stop = api.onChanged((next) => { if (alive) setState(next) })
    void api.state().then((next) => { if (alive && next !== undefined) setState((was) => was ?? next) }).catch(() => undefined)
    return () => { alive = false; stop() }
  }, [api])
  return state
}
