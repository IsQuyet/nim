import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './modules/*/server/schema.ts',
  out: './drizzle',
})
