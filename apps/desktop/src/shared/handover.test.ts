import { describe, expect, it } from 'vitest'

import { MAX_FILES_PER_REPLY, handedFileOnDisk, isWholePath, parseFileBlocks, refusedFileLines, stripFileBlocks } from './handover.js'

/**
 * A teammate hands the person a file.
 *
 * Colin, 2026-09-19, with a screenshot of the failure: he asked Yurt to "send
 * me an md of your report" and got back a file path as a sentence. The work
 * was done and the file was on disk; the app had no way for a teammate to say
 * "here it is", so the person was told to go and find it.
 *
 * The parser is the whole security surface of the feature, because the path
 * it returns is joined to the workspace folder and handed to the host's
 * reveal. Everything that could point outside that folder is dropped here.
 */

describe('reading a handover block', () => {
  it('reads one file and its note', () => {
    const files = parseFileBlocks('Done.\n<locust-file>\ndocs/report.md :: the rollup you asked for\n</locust-file>')
    expect(files).toEqual([{ path: 'docs/report.md', note: 'the rollup you asked for' }])
  })

  it('reads several, in the order they were written, and the note is optional', () => {
    const files = parseFileBlocks('<locust-file>\na.md\nb.md :: second\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['a.md', 'b.md'])
    expect(files[0]?.note).toBeUndefined()
    expect(files[1]?.note).toBe('second')
  })

  it('finds no files in a reply that has none', () => {
    expect(parseFileBlocks('I wrote docs/report.md for you.')).toEqual([])
  })

  it('takes a model writing the list as bullets', () => {
    // Not a spelling the briefing asks for, and exactly the one a model
    // reaches for when it is listing things. Costs nothing to accept.
    const files = parseFileBlocks('<locust-file>\n- docs/a.md :: one\n* docs/b.md\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['docs/a.md', 'docs/b.md'])
  })

  it('writes one spelling of a path, whichever the model used', () => {
    const files = parseFileBlocks('<locust-file>\ndocs\\sub\\report.md\n./notes.md\n</locust-file>')
    expect(files.map((file) => file.path)).toEqual(['docs/sub/report.md', 'notes.md'])
  })

  it('draws one button for a file named twice', () => {
    const files = parseFileBlocks('<locust-file>\ndocs/a.md :: the report\ndocs/a.md :: also the report\n</locust-file>')
    expect(files).toHaveLength(1)
  })
})

describe('paths this app will not point at', () => {
  const dropped = (path: string): number => parseFileBlocks(`<locust-file>\n${path}\n</locust-file>`).length

  it('leaves a path that climbs out of the folder to the host, which knows the folders Locust works in (0.516)', () => {
    // A teammate in one folder handed a report it wrote in another Locust works in. Dropped
    // here, it learned to copy files into its own folder instead. The host's reveal, preview
    // and copy each check the path against the folders it knows (reveal-file.ts), so a `..`
    // path anywhere else is still refused -- there, with its reason, when pressed.
    expect(dropped('../Documents/repo/docs/report.md')).toBe(1)
    expect(dropped('docs/../../other/report.md')).toBe(1)
    expect(dropped('..rc')).toBe(1)
  })

  it('leaves a whole path to the host too, which opens it only when the teammate named it as its own (0.787)', () => {
    // Codex wrote its review where it was asked to, D:\work\scratch, and
    // handed it over by that path; dropped here, the thread said only "Not
    // shown as a file" (Colin, 2026-10-18). The host opens a whole path
    // outside its folders only for a file the teammate's own record names
    // (main/named-files.ts), so these reach it and are judged there.
    expect(parseFileBlocks('<locust-file>\nD:\\work\\scratch\\toaster-review2\\Codex.md :: the review\n</locust-file>')).toEqual([
      { path: 'D:/work/scratch/toaster-review2/Codex.md', note: 'the review' }
    ])
    expect(dropped('/Users/someone/notes/report.md')).toBe(1)
    expect(dropped('C:/Users/someone/Desktop/report.md')).toBe(1)
  })

  it('drops a network or device path, which would reach another computer just by being looked at', () => {
    expect(dropped('\\\\server\\share\\file.txt')).toBe(0)
    expect(dropped('//server/share/file.txt')).toBe(0)
    expect(dropped('\\\\?\\C:\\Windows\\win.ini')).toBe(0)
    expect(dropped('\\\\.\\pipe\\anything')).toBe(0)
  })

  it('drops a drive with no folder, which names wherever that drive last was', () => {
    expect(dropped('D:report.md')).toBe(0)
  })

  it('says under the message what it dropped, and no longer says it of a whole path (0.787)', () => {
    const block = '<locust-file>\nD:/work/scratch/review/Codex.md\n\\\\server\\share\\file.txt\n</locust-file>'
    expect(refusedFileLines(block).map((line) => line.path)).toEqual(['//server/share/file.txt'])
  })

  it('drops a path carrying a control character', () => {
    expect(dropped(`docs/report${String.fromCharCode(0)}.md`)).toBe(0)
    expect(dropped(`docs/report${String.fromCharCode(27)}[2K.md`)).toBe(0)
  })

  it('drops an empty line rather than drawing a button to nothing', () => {
    expect(parseFileBlocks('<locust-file>\n\n\n</locust-file>')).toEqual([])
  })

  it('stops at four files', () => {
    const lines = Array.from({ length: 9 }, (_, index) => `docs/file-${String(index)}.md`).join('\n')
    expect(parseFileBlocks(`<locust-file>\n${lines}\n</locust-file>`)).toHaveLength(MAX_FILES_PER_REPLY)
  })

  it('bounds a note, because it is a caption on a button', () => {
    const note = 'x'.repeat(400)
    const [file] = parseFileBlocks(`<locust-file>\ndocs/a.md :: ${note}\n</locust-file>`)
    expect(file?.note?.length).toBeLessThanOrEqual(120)
    expect(file?.note?.endsWith('…')).toBe(true)
  })
})

describe('where a handed file is on disk', () => {
  it('is in the conversation\'s folder for a path in it, and the path itself for a whole one (0.787)', () => {
    expect(handedFileOnDisk('C:/Users/someone/.claude', 'docs/report.md')).toBe('C:/Users/someone/.claude/docs/report.md')
    // Joined, this was C:/Users/someone/.claude/D:/work/..., a file that cannot exist.
    expect(handedFileOnDisk('C:/Users/someone/.claude', 'D:/work/scratch/review/Codex.md')).toBe('D:/work/scratch/review/Codex.md')
    expect(handedFileOnDisk('/home/someone/project', '/home/someone/notes.md')).toBe('/home/someone/notes.md')
  })

  it('tells a whole path from one in the folder', () => {
    expect(isWholePath('D:/work/a.md')).toBe(true)
    expect(isWholePath('/home/a.md')).toBe(true)
    expect(isWholePath('docs/a.md')).toBe(false)
    expect(isWholePath('../Documents/a.md')).toBe(false)
  })
})

describe('what the person reads', () => {
  it('shows the answer, not the protocol', () => {
    const said = 'Here is the rollup.\n\n<locust-file>\ndocs/report.md :: the rollup\n</locust-file>'
    expect(stripFileBlocks(said)).toBe('Here is the rollup.')
    expect(stripFileBlocks(said)).not.toContain('locust-file')
  })

  it('leaves a reply with no block exactly as it was', () => {
    expect(stripFileBlocks('Nothing to hand over.')).toBe('Nothing to hand over.')
  })
})
