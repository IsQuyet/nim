import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    maxWorkers: 4,
    exclude: [...configDefaults.exclude, 'e2e/**'],
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
