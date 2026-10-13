import { describe, expect, it } from 'vitest'

import { judgeMissionIds, type PublicCompare } from './compare.js'
import { DRAFT_MAX_POINTS, draftedPoints, pointsDraftRequest } from './compare-score.js'

/*
 * DRAFT THE POINTS (0.766), the canvas "Your Own Benchmark": "Locust drafts that list (the rubric) from the task with
 * a cheap model. You edit it." The model is asked not to answer, only to say what a good answer must do, in the
 * scorecard's own POINT form -- read loosely, kept strictly -- and its run is the comparison's.
 */
describe('the points, drafted', () => {
  it('asks for points only, in the POINT form, about the request itself', () => {
    const asked = pointsDraftRequest('Which CRM should a five-person team buy?')
    expect(asked).toContain('Which CRM should a five-person team buy?')
    expect(asked).toContain('Do not answer it.')
    expect(asked).toMatch(/^POINT 1: </m)
  })

  it('reads the points in order, each once, bold and bullets and all, and at most five', () => {
    const said = [
      'Here are the points:',
      '- **POINT 1:** Names one CRM to buy',
      'POINT 2 - Gives a price for five seats',
      'POINT 2: said twice, so not kept',
      'POINT 4: out of order, so not kept',
      'POINT 3: Fits a five-person team',
      'POINT 4: Says why it beats the others',
      'POINT 5: One sentence',
      'POINT 6: one too many'
    ].join('\n')
    expect(draftedPoints(said)).toEqual(['Names one CRM to buy', 'Gives a price for five seats', 'Fits a five-person team', 'Says why it beats the others', 'One sentence'])
    expect(draftedPoints(said)).toHaveLength(DRAFT_MAX_POINTS)
    expect(draftedPoints('I would buy HubSpot.')).toEqual([])
  })

  it('keeps a drafting run as the comparison\'s, never a conversation', () => {
    const compare: PublicCompare = {
      compareId: 'cmp_1',
      prompt: 'Which CRM?',
      createdAt: '2026-10-12T18:00:00.000Z',
      slots: [],
      pointDrafts: ['m_draft']
    }
    expect(judgeMissionIds([compare]).has('m_draft')).toBe(true)
  })
})
