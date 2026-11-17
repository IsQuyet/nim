import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './modules/*/server/schema.ts',
  out: './drizzle',
})
