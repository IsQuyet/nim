import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { Pool } from 'pg'
import { getDatabaseTarget, isPostgresUrl } from './data-paths'

export type AppDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>

export type ManagedDatabase = AppDatabase & {
  close(): Promise<void>
}

const sharedConnections = new Map<string, Promise<ManagedDatabase>>()

async function createConnection(target: string): Promise<ManagedDatabase> {
  if (isPostgresUrl(target)) {
    const pool = new Pool({ connectionString: target })
    let closed = false
    pool.on('error', error => {
      if (!closed) console.error('PostgreSQL 连接池连接异常。', error)
    })
    const database = drizzlePg(pool) as unknown as AppDatabase
    return Object.assign(database, {
      async close() {
        if (closed) return
        closed = true
        await pool.end()
      },
    })
  }

  if (!existsSync(join(/* turbopackIgnore: true */ target, 'PG_VERSION'))) {
    throw new Error(`数据库尚未初始化：${target}`)
  }

  const client = await PGlite.create(/* turbopackIgnore: true */ target)
  let closed = false
  const database = drizzlePglite(client) as unknown as AppDatabase
  return Object.assign(database, {
    async close() {
      if (closed) return
      closed = true
      await client.close()
    },
  })
}

export async function initializeDatabase(target = getDatabaseTarget()) {
  if (isPostgresUrl(target)) {
    const pool = new Pool({ connectionString: target })
    try {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator')
      await migrate(drizzlePg(pool), { migrationsFolder: './drizzle' })
    } finally {
      await pool.end()
    }
    return
  }

  mkdirSync(/* turbopackIgnore: true */ target, { recursive: true })
  const client = await PGlite.create(/* turbopackIgnore: true */ target)
  try {
    const { migrate } = await import('drizzle-orm/pglite/migrator')
    await migrate(drizzlePglite(client), { migrationsFolder: './drizzle' })
  } finally {
    await client.close()
  }
}

export async function openDatabase(target = getDatabaseTarget()): Promise<ManagedDatabase> {
  return createConnection(target)
}

export async function getSharedDatabase(target = getDatabaseTarget()): Promise<ManagedDatabase> {
  let pending = sharedConnections.get(target)
  if (!pending) {
    pending = createConnection(target).catch(error => {
      sharedConnections.delete(target)
      throw error
    })
    sharedConnections.set(target, pending)
  }
  return pending
}

/** 关闭当前进程内缓存的共享数据库连接（主要用于测试清理或切换环境变量）。 */
export async function closeDatabaseConnections() {
  const entries = Array.from(sharedConnections.values())
  sharedConnections.clear()
  for (const pending of entries) {
    try {
      const connection = await pending
      await connection.close()
    } catch {
      // 忽略创建期已经失败的连接。
    }
  }
}

/** 在数据库上下文内执行异步操作；显式传入目标连接时会在操作完成后关闭本次连接。 */
export async function withDatabase<T>(
  operation: (database: AppDatabase) => Promise<T> | T,
  target?: string,
): Promise<Awaited<T>> {
  if (target !== undefined) {
    const database = await openDatabase(target)
    try {
      return await operation(database)
    } finally {
      await database.close()
    }
  }

  const database = await getSharedDatabase()
  return await operation(database)
}
