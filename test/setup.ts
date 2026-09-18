import { existsSync } from 'node:fs'

/**
 * Vitest does not read .env.local; Next does. The unit tests do not care, but
 * the integration file needs DATABASE_URL and skips itself without it — which
 * would make it silently skip everywhere rather than only in CI.
 */
if (existsSync('.env.local')) process.loadEnvFile('.env.local')
