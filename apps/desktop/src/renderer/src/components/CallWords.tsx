import type { ReactElement } from 'react'

import { callLength, type CallPiece, type SavedCallLine } from '../../../shared/calls.js'
import type { PublicTeammate } from '../../../shared/ipc.js'
import type { VoiceCallRole } from '../../../shared/voice-call.js'
import { Icon } from './Icon.js'
import { TeammateBot } from './TeammateBot.js'

/*
 * WHAT WAS SAID ON A CALL, IN THE THREAD (0.747). The canvas Colin passed on 2026-10-11: a call with a teammate
 * lives in that teammate's conversation -- your words as your bubbles, theirs beside their face, each marked as said
 * rather than typed -- among the turns the call started, which are already in the record. Live, it grows as you
 * talk; ended, it folds to one line that opens again.
 */

/** A piece of a call as the thread draws it: the call, live or kept, and where its words go. */
export interface CallPieceShown extends CallPiece {
  /** On now: drawn open, growing, with words still being said. */
  readonly live: boolean
  readonly partial?: Readonly<Record<VoiceCallRole, string>>
}

const at = (time: number): string => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function SaidMark(): ReactElement {
  return <span className="lc-callsaid__mark"><Icon name="mic" size={11} />Said</span>
}

function Line({ line, teammate, partial }: { readonly line: SavedCallLine; readonly teammate: PublicTeammate | undefined; readonly partial?: boolean }): ReactElement {
  if (line.role === 'you') {
    return <div className={`lc-callsaid is-you${partial === true ? ' is-partial' : ''}`}>
      <div className="lc-callsaid__bubble">{line.text}</div>
      {partial !== true && <SaidMark />}
    </div>
  }
  return <div className={`lc-callsaid is-voice${partial === true ? ' is-partial' : ''}`}>
    <span className="lc-callsaid__gutter">
      {teammate !== undefined && <TeammateBot hue={teammate.hue} avatar={teammate.avatar} size={20} teammateId={teammate.teammateId} hopsWhenDone={false} />}
    </span>
    <div className="lc-callsaid__body">
      <p className="lc-callsaid__text">{line.text}</p>
      {partial !== true && <SaidMark />}
    </div>
  </div>
}

export function CallWords({ piece, teammate, open, onToggle }: {
  readonly piece: CallPieceShown
  readonly teammate: PublicTeammate | undefined
  /** An ended call shows its words only when opened. */
  readonly open: boolean
  readonly onToggle: () => void
}): ReactElement {
  const { call, live } = piece
  const shut = !live && !open
  const said = call.lines.length
  const partial = live && piece.last ? piece.partial : undefined
  return <>
    {piece.first && (shut
      ? <button type="button" className="lc-callrow" onClick={onToggle} aria-expanded={false}>
        <span className="lc-callrow__mark"><Icon name="waveform" size={14} /></span>
        <span className="lc-callrow__words">
          <span className="lc-callrow__title">{`Call with ${call.name} · ${callLength(call)}`}</span>
          <span className="lc-callrow__note">{`${String(said)} ${said === 1 ? 'line' : 'lines'} said${call.turns.length > 0 ? ` · asked ${call.name} ${String(call.turns.length)} ${call.turns.length === 1 ? 'time' : 'times'}` : ''}`}</span>
        </span>
        <span className="lc-callrow__open">Show what was said</span>
      </button>
      : <div className="lc-calldivider lc-mono">
        <span className="lc-calldivider__rule" />
        <span className="lc-calldivider__words">
          {live && <span className="lc-calldivider__dot" aria-hidden="true" />}
          {`Call with ${call.name} · ${at(call.startedAt)}`}
        </span>
        {!live && <button type="button" className="lc-calldivider__hide" onClick={onToggle} aria-expanded={true}>Hide</button>}
        <span className="lc-calldivider__rule" />
      </div>)}
    {!shut && piece.lines.map((line, index) => <Line key={`${String(line.at)}-${String(index)}`} line={line} teammate={teammate} />)}
    {partial !== undefined && (['you', 'voice'] as const).map((role) => partial[role].trim().length > 0
      && <Line key={`partial-${role}`} line={{ role, text: partial[role].trim(), at: Date.now() }} teammate={teammate} partial />)}
    {!shut && !live && piece.last && <div className="lc-thread__marker lc-mono">{`Call ended · ${callLength(call)}`}</div>}
  </>
}
