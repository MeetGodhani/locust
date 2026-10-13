import { describe, expect, it } from 'vitest'

import { changedPaths, MAX_WALK_DIFF_CHARS, readWalkthrough, walkthroughPrompt } from '../shared/walkthrough.js'

/*
 * WALK ME THROUGH THIS CHANGE (0.771). The teammate is given the change the Changes panel shows, what was asked and
 * what it said when it finished, and answers in one shape; the panel reads from that shape the summary and a note on
 * each file it has, in the order given, and nothing else.
 */
const DIFF = [
  'diff --git a/src/total.js b/src/total.js',
  '--- a/src/total.js',
  '+++ b/src/total.js',
  '@@ -1 +1 @@',
  '-export const total = (lines) => lines.reduce((sum, line) => sum - line.amount, 0)',
  '+export const total = (lines) => lines.reduce((sum, line) => sum + line.amount, 0)',
  'diff --git a/test/total.test.js b/test/total.test.js',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/test/total.test.js',
  '@@ -0,0 +1 @@',
  "+console.assert(total([{ amount: 2 }, { amount: 3 }]) === 5)",
  ''
].join('\n')
const PATHS = ['src/total.js', 'test/total.test.js']

describe('what the teammate is given', () => {
  it('is the files, the change, what was asked and what it said, with the shape to answer in', () => {
    expect(changedPaths(DIFF)).toEqual(PATHS)
    const prompt = walkthroughPrompt({ diff: DIFF, cut: false, paths: PATHS, asks: ['Fix the total'], said: 'It subtracted; it adds now.' })
    expect(prompt).toContain('do not read files or run commands')
    expect(prompt).toContain('What the person asked for:\n- Fix the total')
    expect(prompt).toContain('What was said when the work was done:\nIt subtracted; it adds now.')
    expect(prompt).toContain('The files changed:\n- src/total.js\n- test/total.test.js')
    expect(prompt).toContain(`The change:\n${DIFF}`)
    expect(prompt.endsWith('END')).toBe(true)
    // A change past the limit is cut, and says so.
    const big = walkthroughPrompt({ diff: `${DIFF}${'+x\n'.repeat(MAX_WALK_DIFF_CHARS)}`, cut: false, paths: PATHS, asks: [] })
    expect(big).toContain('(cut short; the list of files above is whole)')
    expect(big.length).toBeLessThan(MAX_WALK_DIFF_CHARS + 3_000)
  })
})

describe('the walkthrough in the answer', () => {
  it('is the summary and a note on each file the change has, in the order given', () => {
    const walk = readWalkthrough([
      'Sure, here it is.',
      'SUMMARY: The total now adds each line',
      'instead of subtracting it, and a test holds it there.',
      'FILE: test/total.test.js',
      'WHY: A new test: two lines of 2 and 3 come to 5.',
      'FILE: `src/total.js` (modified)',
      'WHY: The reducer added a minus sign; it adds now.',
      'Check the empty invoice too: it comes to 0.',
      'CHECK: An invoice with no lines.',
      'END',
      'Anything else?'
    ].join('\n'), PATHS)
    expect(walk).toEqual({
      summary: 'The total now adds each line instead of subtracting it, and a test holds it there.',
      files: [
        { path: 'test/total.test.js', why: 'A new test: two lines of 2 and 3 come to 5.' },
        // A line of the note that begins "Check the..." is still the note; the label needs its colon.
        { path: 'src/total.js', why: 'The reducer added a minus sign; it adds now. Check the empty invoice too: it comes to 0.', check: 'An invoice with no lines.' }
      ]
    })
  })

  it('finds a file by its end or its name, and leaves out one the change does not have', () => {
    const walk = readWalkthrough([
      '**SUMMARY:** Fixes the total.',
      '**FILE:** total.js',
      '**WHY:** Adds.',
      'FILE: src/billing/invoice.js',
      'WHY: Invented.',
      'FILE: ./test/total.test.js',
      'WHY: Tests it.',
      'FILE: test/total.test.js',
      'WHY: Twice.'
    ].join('\n'), PATHS)
    expect(walk?.files.map((file) => file.path)).toEqual(['src/total.js', 'test/total.test.js'])
    expect(walk?.files[1]?.why).toBe('Tests it.')
  })

  it('is nothing without a summary', () => {
    expect(readWalkthrough('FILE: src/total.js\nWHY: Adds.\nEND', PATHS)).toBeUndefined()
    expect(readWalkthrough('The total adds now.', PATHS)).toBeUndefined()
  })
})
