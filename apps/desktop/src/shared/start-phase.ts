import type { StartPhase } from './ipc.js'

/**
 * What the live line says while a teammate's turn is starting (0.602).
 *
 * Measured 10/04 on 183 of Colin's missions: a median 4.5 s (Claude Code),
 * 5.5 s (Codex) and 10.5 s (Cursor) pass between Send and the runtime's
 * "started", and for all of it the line said the one word "Starting", which
 * reads as a hang. The main process now says which phase it is in; this is
 * the word for each.
 */
export function startPhaseLabel(phase: StartPhase | undefined, runtimeName: string): string {
  switch (phase) {
    case 'looking':
      return `Looking for ${runtimeName}`
    case 'briefing':
      return 'Briefing'
    case 'reading-folder':
      return 'Reading the folder'
    case 'starting-runtime':
      return `Starting ${runtimeName}`
    // Your cloud computer (0.761). MEASURED: made in about 35 s, woken in about a minute and a half.
    case 'cloud-making':
      return 'Making your cloud computer, about a minute'
    case 'cloud-waking':
      return 'Waking your cloud computer, about a minute and a half'
    case 'cloud-installing':
      return `Setting up ${runtimeName} on your cloud computer`
    case 'cloud-bringing':
      return 'Bringing this folder to your cloud computer'
    default:
      return 'Starting'
  }
}
