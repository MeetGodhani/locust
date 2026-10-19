import { describe, expect, it } from 'vitest'

import type { PublicRuntimeStatus } from '../../shared/ipc.js'
import { routeRowStatus } from './status.js'

/*
 * OPENCODE 2 READS AS NOT SUPPORTED YET (0.805). With OpenCode 2 installed, Locust's OpenCode turns failed with "the
 * event stream closed" while the picker offered its models as ready. The window now says the version is not run yet,
 * in those words, and does not offer the route -- nor tell the person it is "checking again". (The host's half:
 * main/opencode-2-reaches-the-window-as-unsupported.test.ts.)
 */
const NOTE = 'OpenCode 2.0.32 is installed, and Locust runs OpenCode 1 for now: OpenCode 2 changed how other apps talk to it. Support for it is on its way.'

describe('an OpenCode version Locust does not run yet', () => {
  it('is not offered in the picker, and says why rather than "checking"', () => {
    const runtime = { id: 'opencode', displayName: 'OpenCode', installed: true, version: '2.0.32', auth: 'not-applicable', ready: false, status: 'unsupported', unsupportedNote: NOTE } as PublicRuntimeStatus
    const row = routeRowStatus(runtime, 'supported' as never, false)
    expect(row).toMatchObject({ tag: 'UNAVAILABLE', selectable: false, detail: NOTE })
  })
})
