import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getDatabasePath } from './data-paths'

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
  return drizzle(client)
}

export type AppDatabase = ReturnType<typeof openDatabase>

/** 在一个连接内执行操作，等操作结束后关闭连接，结果与错误原样交还调用方。 */
export async function withDatabase<T>(
  operation: (database: AppDatabase) => T,
  filename?: string,
): Promise<Awaited<T>> {
  const database = openDatabase(filename)
  try {
    return await operation(database)
  } finally {
    database.$client.close()
  }
}
