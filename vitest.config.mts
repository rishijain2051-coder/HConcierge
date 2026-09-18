import { defineConfig } from 'vitest/config'

/**
 * The unit suite. `npm test`.
 *
 * Node environment, no jsdom: what is worth testing here is the rules —
 * lateness, the token bucket, the circuit breaker's state machine, the bytes
 * that go to a thermal printer — and none of that needs a DOM. The screens are
 * verified by driving the real app, which a jsdom render would only pretend to
 * do.
 *
 * `test/setup.ts` loads .env.local so the integration file can reach the
 * database when there is one, and skip itself when there is not.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // The database tests share one Postgres pool, and two files running at
    // once would each open their own and race on the fixtures they create.
    fileParallelism: false,
  },
})
