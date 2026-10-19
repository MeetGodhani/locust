import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NormalizedRuntimeEvent } from '@teammate/runtime-adapters'

import { BROWSER_POINT_SHORTCUT } from '../../shared/browser-point.js'
import { DEFAULT_TALK_SHORTCUT } from '../../shared/talk-shortcut.js'
import { Thread } from './components/Thread.js'
import {
  PROMPT_RAIL_KEYS,
  PROMPT_RAIL_MIN,
  PROMPT_RAIL_ROOM,
  currentPromptMark,
  promptMarkPlace,
  promptRailLine,
  promptRailMotion,
  promptRailRoom,
  promptRailScrollable,
  promptRailShows,
  promptRailStep
} from './promptRail.js'

const key = (partial: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; key: string }>) => ({
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  key: '',
  ...partial
})

const turn = (missionId: string, prompt: string) => ({ missionId, prompt, events: [] as NormalizedRuntimeEvent[] })

describe('a long conversation has a rail of your messages', () => {
  it('gives a rail to four of your messages when the thread scrolls, and withholds it otherwise', () => {
    const shown = { messages: PROMPT_RAIL_MIN, scrollable: true, compare: false, room: PROMPT_RAIL_ROOM }
    expect(promptRailShows(shown)).toBe(true)
    expect(promptRailShows({ ...shown, messages: PROMPT_RAIL_MIN - 1 })).toBe(false)
    expect(promptRailShows({ ...shown, scrollable: false })).toBe(false)
    expect(promptRailShows({ ...shown, compare: true })).toBe(false)
    expect(promptRailShows({ ...shown, room: PROMPT_RAIL_ROOM - 1 })).toBe(false)
    expect(promptRailScrollable(800, 400)).toBe(true)
    expect(promptRailScrollable(400, 400)).toBe(false)
    expect(promptRailScrollable(401, 400)).toBe(false)
    expect(promptRailRoom({ threadRight: 1000, scrollbar: 12, paddingRight: 6, columnRight: 900 })).toBe(82)
    const compare = readFileSync(new URL('./components/CompareView.tsx', import.meta.url), 'utf8')
    expect(compare).not.toContain('PromptRail')
    expect(compare).not.toContain('lc-promptrail')
  })

  it('keeps the marks in the order you sent them, and the current one is the message nearest the top', () => {
    const tops = [0, 400, 900, 1500]
    expect(tops.map((top) => promptMarkPlace(top, 2000))).toEqual([0, 0.2, 0.45, 0.75])
    expect(currentPromptMark(tops, 0)).toBe(0)
    expect(currentPromptMark(tops, 420)).toBe(1)
    expect(currentPromptMark(tops, 2000)).toBe(3)
    // Equidistant: the earlier message stays current.
    expect(currentPromptMark([0, 100], 50)).toBe(0)
  })

  it('jumps with Ctrl+Alt+Up and Ctrl+Alt+Down, which the other shortcuts do not use', () => {
    expect(promptRailStep(key({ ctrlKey: true, altKey: true, key: 'ArrowDown' }))).toBe(1)
    expect(promptRailStep(key({ ctrlKey: true, altKey: true, key: 'ArrowUp' }))).toBe(-1)
    // Alt+Up / Alt+Down move between conversations, and only when Ctrl is not held.
    expect(promptRailStep(key({ altKey: true, key: 'ArrowUp' }))).toBeUndefined()
    expect(promptRailStep(key({ altKey: true, key: 'ArrowDown' }))).toBeUndefined()
    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
    expect(app).toContain("event.altKey && !accel && (event.key === 'ArrowDown' || event.key === 'ArrowUp')")
    // Talk is Ctrl+Alt+Space. Find is Ctrl+F. Pointing at the browser is Ctrl+Shift+C. The terminal is Ctrl+`.
    expect(DEFAULT_TALK_SHORTCUT).toBe('Ctrl+Alt+Space')
    expect(promptRailStep(key({ ctrlKey: true, altKey: true, key: ' ' }))).toBeUndefined()
    expect(BROWSER_POINT_SHORTCUT).toBe('Ctrl+Shift+C')
    expect(promptRailStep(key({ ctrlKey: true, shiftKey: true, key: 'c' }))).toBeUndefined()
    expect(promptRailStep(key({ ctrlKey: true, key: 'f' }))).toBeUndefined()
    expect(promptRailStep(key({ ctrlKey: true, key: '`' }))).toBeUndefined()
    const terminal = readFileSync(new URL('./components/TerminalToggle.tsx', import.meta.url), 'utf8')
    expect(terminal).toContain('aria-keyshortcuts="Control+`"')
    expect(promptRailMotion(true)).toEqual({ scroll: 'auto', highlight: false })
    expect(promptRailMotion(false)).toEqual({ scroll: 'smooth', highlight: true })
    const rail = readFileSync(new URL('./components/PromptRail.tsx', import.meta.url), 'utf8')
    expect(rail).toContain('PROMPT_RAIL_KEYS')
    expect(PROMPT_RAIL_KEYS).toBe('Ctrl+Alt+Up and Ctrl+Alt+Down')
  })

  it('takes the hover line from that message', () => {
    expect(promptRailLine('Where does the prompt rail sit?\nThe rest is underneath.')).toBe('Where does the prompt rail sit?')
    expect(promptRailLine('**How far apart** are the marks?')).toBe('How far apart are the marks?')
    expect(promptRailLine('  \nWhat does a hover say?')).toBe('What does a hover say?')
    expect(promptRailLine('[the notes](notes.md) are the point')).toBe('the notes are the point')
    const long = 'Where does a click land when the first line keeps going well past what a hover should show'
    expect(promptRailLine(long).endsWith('…')).toBe(true)
    expect(promptRailLine(long).length).toBeLessThanOrEqual(72)
    const html = renderToStaticMarkup(
      <Thread
        prompt="Does the rail stay off the words?"
        earlierTurns={[
          turn('m1', 'Where does the prompt rail sit?'),
          turn('m2', 'How far apart are the marks?'),
          turn('m3', 'Which mark is the current one?'),
          turn('m4', 'What does a hover say?')
        ]}
        events={[]}
        running={false}
        onOpenPeerRun={() => undefined}
        restoredMission={undefined}
        error={undefined}
        errorIsPersistence={false}
        startedAt={undefined}
        approvals={[]}
        onDecide={() => undefined}
        onAnswerQuestion={() => undefined}
        decidingIds={[]}
        cancelled={false}
        handoff={undefined}
        peers={{ self: undefined, teammates: [], messages: [], notices: [] }}
      />
    )
    expect(html).toContain('data-prompt-mark="Where does the prompt rail sit?"')
    expect(html).toContain('data-prompt-mark="How far apart are the marks?"')
    expect(html).toContain('data-prompt-mark="Does the rail stay off the words?"')
    expect(html.match(/data-prompt-mark=/g)?.length).toBe(5)
  })
})
