import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * THE RENDERER DRAWS ITS OWN SELECTS.
 *
 * A native select opens the operating system's list in the middle of Locust's
 * menus. Every choice control in the renderer is Locust's own.
 */

const RENDERER = fileURLToPath(new URL('../renderer/src/', import.meta.url))

function sources(directory: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) found.push(...sources(path))
    else if (/\.tsx?$/.test(name) && !name.includes('.test.')) found.push(path)
  }
  return found
}

describe('the renderer draws its own selects', () => {
  it('has no native select left', () => {
    const files = sources(RENDERER)
    expect(files.length).toBeGreaterThan(50)
    const hits = files.flatMap((path) => /<select[\s>/]/.test(readFileSync(path, 'utf8')) ? [path.slice(RENDERER.length)] : [])
    expect(hits).toEqual([])
  })
})
