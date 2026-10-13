/**
 * THE RUNS WHOSE ANSWER BELONGS TO A PANEL (0.771, main/panel-runs.ts): a commit message written from the changes, a
 * walk through a change. The window asks for them once and learns each new one as it starts, and never lists one
 * among the conversations.
 */
export const PANEL_RUNS_CHANNEL = 'panel-runs:list'

/** The kinds of run a panel asks for, as the window is told one started. */
export type PanelRunKind = 'commit-draft' | 'walkthrough'

export function isPanelRunKind(kind: string | undefined): kind is PanelRunKind {
  return kind === 'commit-draft' || kind === 'walkthrough'
}
