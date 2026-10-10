import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MissionApprovalRequest } from '../../shared/ipc.js'
import { ApprovalCard } from './components/ApprovalCard.js'

/**
 * A COMMAND'S CARD SAYS "UNKNOWN" ONCE (0.735).
 *
 * Copilot's card for `echo LOCUST-ACP-OK > approved.txt` (drive, 2026-10-10)
 * said Unknown under Data sent and again under Reversible, both ending "anything
 * the sandbox allows". When neither knows anything they are one row; a command
 * that can reach the network, a route's own words, and a file change keep both.
 */

const asked = (over: Partial<MissionApprovalRequest>): MissionApprovalRequest => ({
  approvalId: 'ap_1',
  runId: 'run_1',
  missionId: 'mission_1',
  kind: 'command',
  summary: 'Run a command',
  detail: 'echo LOCUST-ACP-OK > approved.txt',
  cwd: 'C:\\work',
  requestedAt: '2026-10-10T22:00:00.000Z',
  runtime: 'copilot',
  ...over
})
const card = (over: Partial<MissionApprovalRequest> = {}): string =>
  renderToStaticMarkup(<ApprovalCard request={asked(over)} onDecide={() => undefined} onAnswer={() => undefined} busy={false} />)

describe('a command card’s effects', () => {
  it('are one row when Locust can tell nothing about them', () => {
    const html = card()
    expect(html).toContain('<dt>Effects</dt><dd>Unknown. Locust cannot tell what a command sends or undo what it does; it can do anything the sandbox allows.</dd>')
    expect(html).not.toContain('<dt>Data sent</dt>')
    expect(html).not.toContain('<dt>Reversible</dt>')
    expect(html.match(/Unknown/g)).toHaveLength(1)
  })

  it('stay two rows whenever either row knows something', () => {
    const network = card({ detail: 'curl https://example.com -o page.html' })
    expect(network).toContain('<dt>Data sent</dt><dd>This command can reach the network.')
    expect(network).toContain('<dt>Reversible</dt>')
    expect(network).not.toContain('<dt>Effects</dt>')
    const said = card({ reversibleSays: 'Nothing on this machine is changed by a fetch.' })
    expect(said).toContain('<dt>Reversible</dt><dd>Nothing on this machine is changed by a fetch.</dd>')
    expect(said).toContain('<dt>Data sent</dt>')
    const edit = card({ kind: 'file-change', summary: 'Edit a file', detail: 'cart.py' })
    expect(edit).toContain('<dt>Data sent</dt><dd>Nothing. The change is written to this machine and sent nowhere.</dd>')
    expect(edit).toContain('<dt>Reversible</dt>')
    expect(edit).not.toContain('<dt>Effects</dt>')
  })
})
