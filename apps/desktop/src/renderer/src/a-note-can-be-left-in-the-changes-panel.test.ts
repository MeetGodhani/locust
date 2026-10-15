import { describe, expect, it } from 'vitest'

import APP from './App.tsx?raw'

/*
 * NOTES IN THE CHANGES PANEL (0.776). A note on a line (0.376) could be left only in the conversation's own diffs;
 * the Changes panel and Review changes draw the same DiffView with no place to send one, so no "+". Both now take
 * the conversation on screen's notes -- Review changes only when it is that teammate's branch, since the note goes
 * to the conversation on screen. Drive: _tools/drive-a-note-in-the-changes-panel.mjs.
 */
describe('a note on a line of the folder’s change', () => {
  it('can be left in the Changes panel: it sits inside the notes of the conversation on screen', () => {
    const panel = APP.indexOf('<ChangesPanel')
    const opened = APP.lastIndexOf('<DiffNotesContext.Provider value={diffNotesPlace}>', panel)
    expect(opened).toBeGreaterThan(-1)
    expect(panel - opened).toBeLessThan(80)
  })

  it('can be left in Review changes only for the teammate whose conversation is on screen', () => {
    const review = APP.indexOf('<ReviewChanges')
    const opened = APP.lastIndexOf('<DiffNotesContext.Provider', review)
    expect(APP.slice(opened, review)).toContain('value={reviewing.teammateId === pickedTeammate?.teammateId ? diffNotesPlace : undefined}')
  })
})
