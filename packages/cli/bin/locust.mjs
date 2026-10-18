#!/usr/bin/env node
try {
  const { main } = await import('../dist/index.js')
  process.exitCode = await main()
} catch (error) {
  process.stderr.write(`${error?.code === 'ERR_MODULE_NOT_FOUND' ? 'Build the locust command first: pnpm --filter @teammate/cli build.' : error instanceof Error ? error.message : 'Locust could not finish. Check the conversation in Locust.'}\n`)
  process.exitCode = 1
}
