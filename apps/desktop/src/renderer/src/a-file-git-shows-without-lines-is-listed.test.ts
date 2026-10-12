import { describe, expect, it } from 'vitest'

import { parseUnifiedDiff } from './diff.js'

/*
 * A FILE GIT SHOWS WITHOUT TEXT LINES IS STILL LISTED (0.753, bug hunt 2026-10-12, CH1). git writes an image added or
 * changed, a file renamed and left as it was, a file made executable and a new empty file as a `diff --git` header and
 * the lines under it, with no `---`/`+++`; the parser kept a file only once those had named it, so the Changes panel's
 * list, tree and totals left all of these out, and said nothing. The same parser draws Review changes, cloud task
 * diffs and approval cards.
 */
const BRANCH = [
  'diff --git a/notes.txt b/notes.txt',
  'index 3b18e51..a5c1966 100644',
  '--- a/notes.txt',
  '+++ b/notes.txt',
  '@@ -1 +1 @@',
  '-hello',
  '+hello there',
  'diff --git a/logo.png b/logo.png',
  'index 1a2b3c4..5d6e7f8 100644',
  'Binary files a/logo.png and b/logo.png differ',
  'diff --git a/data.bin b/data.bin',
  'new file mode 100644',
  'index 0000000..9f86d08',
  'Binary files /dev/null and b/data.bin differ',
  'diff --git a/old.md b/new.md',
  'similarity index 100%',
  'rename from old.md',
  'rename to new.md',
  'diff --git a/run.sh b/run.sh',
  'old mode 100644',
  'new mode 100755',
  'diff --git a/.keep b/.keep',
  'new file mode 100644',
  'index 0000000..e69de29',
  'diff --git a/my notes/plan b.md b/my notes/plan b.md',
  'new file mode 100644',
  'diff --git a/gone.png b/gone.png',
  'deleted file mode 100644',
  'index 5d6e7f8..0000000',
  'Binary files a/gone.png and /dev/null differ',
  'diff --git a/last.txt b/last.txt',
  'index 3b18e51..a5c1966 100644',
  '--- a/last.txt',
  '+++ b/last.txt',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  ''
].join('\n')

describe('the files of a diff', () => {
  it('lists every one, with or without text lines, as git said it changed', () => {
    const files = parseUnifiedDiff(BRANCH)
    expect(files.map((file) => [file.path, file.status, file.hunks.length])).toEqual([
      ['notes.txt', 'MODIFIED', 1],
      ['logo.png', 'MODIFIED', 0],
      ['data.bin', 'ADDED', 0],
      ['new.md', 'RENAMED', 0],
      ['run.sh', 'MODIFIED', 0],
      ['.keep', 'ADDED', 0],
      ['my notes/plan b.md', 'ADDED', 0],
      ['gone.png', 'DELETED', 0],
      ['last.txt', 'MODIFIED', 1]
    ])
  })

  it('still reads a file with lines after one without, and a diff of one header alone', () => {
    expect(parseUnifiedDiff('diff --git a/big.log b/big.log\nnew file mode 100644\n')).toEqual([{ path: 'big.log', status: 'ADDED', hunks: [] }])
    // Diffs with no `diff --git` lines at all, as some runtimes send them, are read as before.
    expect(parseUnifiedDiff('--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-a\n+b\n').map((file) => [file.path, file.status])).toEqual([['x.txt', 'MODIFIED']])
  })
})
