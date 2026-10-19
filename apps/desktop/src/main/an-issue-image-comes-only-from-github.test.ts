import { expect, it } from 'vitest'

import { readIssueImages } from './github-issues.js'
import type { ViewedIssue } from '../shared/github-issue.js'

const issue = (body: string): ViewedIssue => ({
  number: 5,
  title: 'Crashes on start',
  url: 'https://github.com/acme/hearth/issues/5',
  body,
  labels: [],
  comments: []
})

function fakeGet(answers: Record<string, { status: number; location?: string; bytes?: Uint8Array }>) {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    const answer = answers[url] ?? { status: 404 }
    return {
      status: answer.status,
      ok: answer.status === 200,
      headers: { get: (name: string) => name.toLowerCase() === 'location' ? answer.location ?? null : null },
      arrayBuffer: async (): Promise<ArrayBuffer> => {
        const bytes = answer.bytes
        if (bytes === undefined) return new ArrayBuffer(0)
        const copy = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(copy).set(bytes)
        return copy
      }
    }
  }
  return { asked, get }
}

it('fetches a picture only from GitHub\'s own hosts, and stops at a redirect that leaves them', async () => {
  const png = new Uint8Array([1, 2, 3])
  const { asked, get } = fakeGet({
    'https://github.com/user-attachments/assets/one': { status: 200, bytes: png },
    'https://user-images.githubusercontent.com/two.png': { status: 302, location: 'https://evil.example/two.png' }
  })
  const images = await readIssueImages(issue('![a](https://github.com/user-attachments/assets/one)\n![b](https://user-images.githubusercontent.com/two.png)\n![c](https://evil.example/c.png)'), get)
  expect(images.map((image) => image.name)).toEqual(['issue-5-1.png'])
  expect(images[0]?.bytes).toEqual(png)
  expect(asked).toEqual([
    'https://github.com/user-attachments/assets/one',
    'https://user-images.githubusercontent.com/two.png'
  ])
  expect(asked).not.toContain('https://evil.example/c.png')
  expect(asked).not.toContain('https://evil.example/two.png')
})

it('follows a redirect that stays on GitHub\'s hosts', async () => {
  const png = new Uint8Array([9])
  const { get } = fakeGet({
    'https://github.com/user-attachments/assets/one': { status: 302, location: 'https://private-user-images.githubusercontent.com/one.png' },
    'https://private-user-images.githubusercontent.com/one.png': { status: 200, bytes: png }
  })
  const images = await readIssueImages(issue('![a](https://github.com/user-attachments/assets/one)'), get)
  expect(images).toEqual([{ name: 'issue-5-1.png', bytes: png }])
})
