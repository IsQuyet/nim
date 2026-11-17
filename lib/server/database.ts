import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getDatabasePath } from './data-paths'
import * as schema from '../schema'

export async function initializeDatabase(filename = getDatabasePath()) {
  mkdirSync(dirname(filename), { recursive: true })
  const client = new Database(filename)

  try {
    client.pragma('foreign_keys = ON')
    client.pragma('journal_mode = WAL')
    const { migrate } = await import('drizzle-orm/better-sqlite3/migrator')
    migrate(drizzle(client), { migrationsFolder: './drizzle' })
  } finally {
    client.close()
  }
}

export function openDatabase(filename = getDatabasePath()) {
  const client = new Database(filename, { fileMustExist: true })
  client.pragma('foreign_keys = ON')
  return drizzle(client, { schema })
}

export type AppDatabase = ReturnType<typeof openDatabase>
