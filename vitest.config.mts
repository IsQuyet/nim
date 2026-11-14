import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    maxWorkers: 4,
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
})
