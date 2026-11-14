// @vitest-environment node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, openDatabase } from './database'
import { account, session, user, verification } from './schema'
import { createPostStore } from './posts'

const migration = vi.hoisted(() => ({ folder: undefined as string | undefined }))
vi.mock('drizzle-orm/better-sqlite3/migrator', async importOriginal => {
  const actual = await importOriginal<typeof import('drizzle-orm/better-sqlite3/migrator')>()
  return {
    ...actual,
    migrate: (...args: Parameters<typeof actual.migrate>) => actual.migrate(args[0], {
      ...args[1],
      ...(migration.folder ? { migrationsFolder: migration.folder } : {}),
    }),
  }
})

let directory: string
let filename: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-database-'))
  filename = join(directory, 'nim.sqlite')
  migration.folder = undefined
})

afterEach(() => {
  vi.restoreAllMocks()
  if (directory) rmSync(directory, { recursive: true })
})

function readContents() {
  const database = new Database(filename, { readonly: true })
  try {
    return Object.fromEntries(['posts', 'post_contents', 'user', 'session', 'account', 'verification']
      .map(table => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]))
  } finally {
    database.close()
  }
}

describe('数据库结构与迁移', () => {
  it('运行时打开未初始化的数据库明确失败，不隐式创建文件', () => {
    expect(() => openDatabase(filename)).toThrow()
    expect(existsSync(filename)).toBe(false)
  })

  it('首次准备文章和认证结构，约束文章身份、快照阶段及外键', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    const client = database.$client

    try {
      expect(client.pragma('table_info(posts)')).toEqual([
        expect.objectContaining({ name: 'id', pk: 1, notnull: 1 }),
        expect.objectContaining({ name: 'created_at', pk: 0, notnull: 1 }),
      ])
      expect(client.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(client.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(1)
      const store = createPostStore(database)
      const draft = store.createDraft({ title: 'Draft', description: '', body: '# Draft\r\n' })
      const insert = client.prepare('INSERT INTO post_contents VALUES (?, ?, ?, ?, ?, ?)')
      expect(() => insert.run(draft.id, 'invalid', '', '', '', '2026-11-14')).toThrow()
      expect(() => insert.run('missing', 'draft', '', '', '', '2026-11-14')).toThrow()
      expect(client.pragma('foreign_key_check')).toEqual([])
    } finally {
      client.close()
    }
  })

  it('重复迁移保留文章原文、时间、认证关联和会话，不重复登记已执行迁移', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    const createdAt = new Date('2026-11-14T00:00:00Z')
    const expiresAt = new Date('2099-01-01T00:00:00Z')
    try {
      const store = createPostStore(database)
      const draft = store.createDraft({ title: 'Published', description: 'Description', body: '# Published\r\n' })
      store.publishDraft(draft.id)
      store.saveDraft(draft.id, { title: 'Edited', description: '', body: '# Edited\n' })
      database.insert(user).values({
        id: 'admin', name: 'Admin', email: 'admin@example.test', emailVerified: true, createdAt, updatedAt: createdAt,
      }).run()
      database.insert(account).values({
        id: 'github-account', accountId: '1234', providerId: 'github', userId: 'admin',
        accessToken: 'stored-token', createdAt, updatedAt: createdAt,
      }).run()
      database.insert(session).values({
        id: 'admin-session', token: 'session-token', userId: 'admin', expiresAt, createdAt, updatedAt: createdAt,
      }).run()
      database.insert(verification).values({
        id: 'oauth-state', identifier: 'state', value: 'verification-data', expiresAt, createdAt, updatedAt: createdAt,
      }).run()
      expect(database.select({ expiresAt: session.expiresAt }).from(session).get()?.expiresAt).toEqual(expiresAt)
    } finally {
      database.$client.close()
    }
    const before = readContents()

    await initializeDatabase(filename)
    await initializeDatabase(filename)

    expect(readContents()).toEqual(before)
    const reopened = new Database(filename, { readonly: true })
    try {
      expect(reopened.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(1)
      expect(reopened.pragma('foreign_key_check')).toEqual([])
    } finally {
      reopened.close()
    }
  })

  it('迁移中途失败回滚结构与数据，释放连接并允许修正后重试', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    try {
      createPostStore(database).createDraft({ title: 'Existing', description: '', body: '# Existing\r\n' })
    } finally {
      database.$client.close()
    }
    const before = readContents()
    const folder = join(directory, 'migrations')
    cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
    const journalPath = join(folder, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    journal.entries.push({
      idx: 1, version: '6', when: journal.entries[0].when + 1, tag: '0001_add_marker', breakpoints: true,
    })
    writeFileSync(journalPath, JSON.stringify(journal))
    const sqlPath = join(folder, '0001_add_marker.sql')
    writeFileSync(sqlPath, 'ALTER TABLE posts ADD COLUMN marker text;\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);')
    migration.folder = folder
    const close = vi.spyOn(Database.prototype, 'close')

    await expect(initializeDatabase(filename)).rejects.toThrow()

    expect(close).toHaveBeenCalledOnce()
    expect(close.mock.contexts[0]).toMatchObject({ open: false })
    expect(readContents()).toEqual(before)
    const inspected = new Database(filename, { readonly: true })
    try {
      expect(inspected.pragma('table_info(posts)')).toHaveLength(2)
      expect(inspected.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(1)
    } finally {
      inspected.close()
    }

    writeFileSync(sqlPath, 'ALTER TABLE posts ADD COLUMN marker text;')
    await initializeDatabase(filename)
    const reopened = new Database(filename, { readonly: true })
    try {
      expect(reopened.pragma('table_info(posts)')).toHaveLength(3)
      expect(reopened.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(2)
    } finally {
      reopened.close()
    }
  })
})
