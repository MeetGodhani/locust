/*
 * THE TALK BUTTON THE KEYS PRESS (0.755, shared/talk-shortcut.ts). The chat box's Talk button says here how to press
 * it, while it is on screen and Talk is ready: start a call, or end the one that is on. Pressed with nothing to take
 * it -- the window was on Settings, or is still opening -- the press waits a few seconds for the button the window
 * goes back to.
 */
const WAIT_MS = 10_000

let press: (() => void) | undefined
let waitingSince: number | undefined

/** The button on screen, from when it is ready; the press waiting for one is taken now. */
export function setTalkPress(next: () => void, now = Date.now()): void {
  press = next
  if (waitingSince !== undefined && now - waitingSince <= WAIT_MS) {
    waitingSince = undefined
    next()
  }
  waitingSince = undefined
}

/** A button going away: only its own, so a newer one that came first stays. */
export function clearTalkPress(mine: () => void): void {
  if (press === mine) press = undefined
}

/** The keys were pressed. True when a button took it; false when it waits for one. */
export function pressTalk(now = Date.now()): boolean {
  if (press !== undefined) {
    waitingSince = undefined
    press()
    return true
  }
  waitingSince = now
  return false
}
