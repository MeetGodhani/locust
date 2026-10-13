import { defineConfig } from 'vitest/config'

// Everything else is vitest's default: the per-file environment comments, the
// default test glob. The one setup file gives every test a TEMP in its real
// spelling (test/real-temp.ts says why).
//
// Except the time a test has on CI. GitHub's Windows runner is many times
// slower at the disk than a PC: a test that keeps a real ledger takes a few
// milliseconds here and went past vitest's 5 s there, twice (the 0.621 and
// 0.745 CI). There a test has 20 s; the gate keeps 5 s and runs a timed-out
// file once more (_tools/gate-support.mjs).
export default defineConfig({
  test: {
    setupFiles: ['./test/real-temp.ts'],
    testTimeout: process.env.CI ? 20_000 : 5_000
  }
})
