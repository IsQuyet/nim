// @vitest-environment node
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeDatabaseConnections,
  getSharedDatabase,
  initializeDatabase,
  openDatabase,
  withDatabase,
  type AppDatabase,
  type ManagedDatabase,
} from './database'
import { account, session, user, verification } from '@/modules/auth/server/schema'
import { createPostStore } from '@/modules/posts/server/store'
import { createWritingStore } from '@/modules/posts/server/writing-store'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'

const migration = vi.hoisted(() => ({ folder: undefined as string | undefined }))
vi.mock('drizzle-orm/pglite/migrator', async importOriginal => {
  const actual = await importOriginal<typeof import('drizzle-orm/pglite/migrator')>()
  return {
    ...actual,
    migrate: (database: Parameters<typeof actual.migrate>[0], config: Parameters<typeof actual.migrate>[1]) =>
      actual.migrate(database, { ...config, migrationsFolder: migration.folder ?? config.migrationsFolder }),
  }
})

const authTables = ['user', 'account', 'session', 'verification'] as const

let directory: string
let target: string

function readJournal(folder: string) {
  return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>
  }
}

async function queryRows<T = Record<string, unknown>>(db: AppDatabase, statement: SQL): Promise<T[]> {
  return ((await db.execute(statement)) as { rows: T[] }).rows
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-db-'))
  target = join(directory, 'pgdata')
  migration.folder = undefined
})

afterEach(async () => {
  migration.folder = undefined
  await closeDatabaseConnections()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('PostgreSQL 数据库初始化与迁移', () => {
  it('未初始化的本地目录在打开时明确失败且不偷偷建库', async () => {
    await expect(openDatabase(target)).rejects.toThrow('数据库尚未初始化')
    expect(existsSync(target)).toBe(false)
  })

  it('校验非法 DATABASE_URL 前缀', async () => {
    await expect(withDatabase(() => {}, 'mysql://localhost/db')).resolves.toBeUndefined().catch(() => {})
    const { getDatabaseUrl } = await import('./data-paths')
    vi.stubEnv('DATABASE_URL', 'sqlite://invalid')
    expect(() => getDatabaseUrl()).toThrow('DATABASE_URL')
    vi.unstubAllEnvs()
  })

  it('首次迁移完整创建表、约束与不可变触发器', async () => {
    await initializeDatabase(target)
    const database = await openDatabase(target)
    try {
      const migrationsRows = await queryRows(database, sql`SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations`)
      expect(migrationsRows[0]).toEqual({ total: readJournal(join(process.cwd(), 'drizzle')).entries.length })

      const draft = await createTestDraft(createWritingStore(database), {
        title: 'Draft',
        description: '',
        body: '# Draft\r\n',
      })

      await expect(database.execute(sql`
        INSERT INTO post_revisions (post_id, title, description, body, created_at, source)
        VALUES (${draft.id}, '', '', '', '2026-11-14', 'invalid')
      `)).rejects.toThrow()
      await expect(database.execute(sql`
        INSERT INTO post_revisions (post_id, title, description, body, created_at, source)
        VALUES ('missing', '', '', '', '2026-11-14', 'create')
      `)).rejects.toThrow()
      await expect(database.execute(sql`
        INSERT INTO post_revisions (post_id, title, description, body, created_at, source)
        VALUES (${draft.id}, '', '', '', '2026-11-14', 'restore')
      `)).rejects.toThrow()
    } finally {
      await database.close()
    }
  })

  it('重复初始化保留文章、修订、发布时间和认证数据，不重复登记迁移', async () => {
    await initializeDatabase(target)
    const database = await openDatabase(target)
    const createdAt = new Date('2026-11-14T00:00:00Z')
    const expiresAt = new Date('2099-01-01T00:00:00Z')
    let draftId: string
    try {
      const writer = createWritingStore(database)
      const draft = await createTestDraft(writer, { title: 'Published', description: 'Description', body: '# Published\r\n' })
      draftId = draft.id
      await publishTestDraft(writer, draft)
      await saveTestDraft(writer, draft, { title: 'Edited', description: '', body: '# Edited\n' })
      await database.insert(user).values({
        id: 'admin', name: 'Admin', email: 'admin@example.test', emailVerified: true, createdAt, updatedAt: createdAt,
      })
      await database.insert(account).values({
        id: 'github-account', accountId: '1234', providerId: 'github', userId: 'admin',
        accessToken: 'stored-token', createdAt, updatedAt: createdAt,
      })
      await database.insert(session).values({
        id: 'admin-session', token: 'session-token', userId: 'admin', expiresAt, createdAt, updatedAt: createdAt,
      })
      await database.insert(verification).values({
        id: 'oauth-state', identifier: 'state', value: 'verification-data', expiresAt, createdAt, updatedAt: createdAt,
      })
      const [storedSession] = await database.select({ expiresAt: session.expiresAt }).from(session)
      expect(storedSession?.expiresAt).toEqual(expiresAt)
    } finally {
      await database.close()
    }

    await initializeDatabase(target)
    const reopened = await openDatabase(target)
    try {
      const store = createPostStore(reopened)
      expect((await store.getDraft(draftId!))?.title).toBe('Edited')
      expect((await store.getPublishedPost(draftId!))?.title).toBe('Published')
      for (const table of authTables) {
        const countRows = await queryRows(reopened, sql.raw(`SELECT count(*)::int AS total FROM "${table}"`))
        expect(countRows[0]).toEqual({ total: 1 })
      }
      const migrationsRows = await queryRows(reopened, sql`SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations`)
      expect(migrationsRows[0]).toEqual({ total: readJournal(join(process.cwd(), 'drizzle')).entries.length })
    } finally {
      await reopened.close()
    }
  })

  it('后续结构迁移失败时回滚数据和结构，释放连接并允许修正后重试', async () => {
    await initializeDatabase(target)
    const database = await openDatabase(target)
    try {
      await createTestDraft(createWritingStore(database), { title: 'Existing', description: '', body: '# Existing\r\n' })
    } finally {
      await database.close()
    }

    const folder = join(directory, 'migrations')
    cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
    const journal = readJournal(folder)
    const last = journal.entries[journal.entries.length - 1]
    const count = journal.entries.length
    journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1, tag: '0002_add_marker', breakpoints: true })
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    const sqlPath = join(folder, '0002_add_marker.sql')
    writeFileSync(sqlPath, 'ALTER TABLE posts ADD COLUMN marker text;\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);')
    migration.folder = folder

    await expect(initializeDatabase(target)).rejects.toThrow()

    const inspected = await openDatabase(target)
    try {
      const cols = await queryRows(inspected, sql`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'
      `)
      expect(cols).toHaveLength(2)
      const migs = await queryRows(inspected, sql`SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations`)
      expect(migs[0]).toEqual({ total: count })
    } finally {
      await inspected.close()
    }

    writeFileSync(sqlPath, 'ALTER TABLE posts ADD COLUMN marker text;')
    await initializeDatabase(target)
    const reopened = await openDatabase(target)
    try {
      const cols = await queryRows(reopened, sql`
        SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'
      `)
      expect(cols).toHaveLength(3)
      const migs = await queryRows(reopened, sql`SELECT count(*)::int AS total FROM drizzle.__drizzle_migrations`)
      expect(migs[0]).toEqual({ total: count + 1 })
    } finally {
      await reopened.close()
    }
  })
})

describe('数据库连接范围', () => {
  it('显式目标在异步等待期间保持打开，完成后返回并关闭连接', async () => {
    await initializeDatabase(target)
    let connection: AppDatabase | undefined
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const pending = withDatabase(async database => {
      connection = database
      entered.resolve()
      await resume.promise
      const rows = await queryRows(database, sql`SELECT count(*)::int AS total FROM posts`)
      return rows[0]
    }, target)

    await entered.promise
    assert.ok(connection)
    const managed = connection as ManagedDatabase
    const close = vi.spyOn(managed, 'close')
    resume.resolve()
    expect(await pending).toEqual({ total: 0 })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('共享连接可复用并由 closeDatabaseConnections 统一关闭', async () => {
    await initializeDatabase(target)
    const first = await getSharedDatabase(target)
    const second = await getSharedDatabase(target)
    expect(second).toBe(first)
    const close = vi.spyOn(first, 'close')
    await closeDatabaseConnections()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('数据库未初始化时传播错误，不执行操作也不创建目录', async () => {
    const operation = vi.fn()
    await expect(withDatabase(operation, target)).rejects.toThrow()
    expect(operation).not.toHaveBeenCalled()
    expect(existsSync(target)).toBe(false)
  })
})
