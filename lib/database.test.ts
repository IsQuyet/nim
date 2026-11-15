// @vitest-environment node
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { initializeDatabase, openDatabase } from './database'
import { account, session, user, verification } from './schema'
import { createPostStore } from './posts'
import { createWritingStore } from './writing-store'
import { createTestDraft, publishTestDraft, saveTestDraft } from '../test/post-commands'

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

const journalSchema = z.object({
  version: z.string(),
  dialect: z.literal('sqlite'),
  entries: z.array(z.object({
    idx: z.number(), version: z.string(), when: z.number(), tag: z.string(), breakpoints: z.boolean(),
  })),
})
const currentTables = ['posts', 'post_revisions', 'post_drafts', 'post_publications', 'post_published', 'post_write_receipts', 'user', 'session', 'account', 'verification']
const authTables = ['user', 'session', 'account', 'verification']
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

function readJournal(folder: string) {
  return journalSchema.parse(JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')))
}

function readContents(tables = currentTables) {
  const database = new Database(filename, { readonly: true })
  try {
    return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all()]))
  } finally {
    database.close()
  }
}

function createSnapshotDatabase() {
  const folder = join(directory, 'baseline')
  cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
  const journal = readJournal(folder)
  journal.entries = journal.entries.slice(0, 1)
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
  const client = new Database(filename)
  client.pragma('foreign_keys = ON')
  migrate(drizzle(client), { migrationsFolder: folder })
  const insertPost = client.prepare('INSERT INTO posts VALUES (?, ?)')
  const insertContent = client.prepare('INSERT INTO post_contents VALUES (?, ?, ?, ?, ?, ?)')
  for (const id of ['draft-only', 'modified', 'equal']) insertPost.run(id, '2026-11-01T00:00:00.000Z')
  insertContent.run('draft-only', 'draft', '  Draft  ', '', '    code\r\n\n', '2026-11-10T00:00:00.000Z')
  insertContent.run('modified', 'draft', 'Edited', 'Private', '# New\r\n', '2026-11-12T00:00:00.000Z')
  insertContent.run('modified', 'published', 'Published', 'Public', '# Old\n', '2026-11-11T00:00:00.000Z')
  insertContent.run('equal', 'draft', 'Equal', '', '# 相同\n\n', '2026-11-14T00:00:00.000Z')
  insertContent.run('equal', 'published', 'Equal', '', '# 相同\n\n', '2026-11-13T00:00:00.000Z')
  client.prepare('INSERT INTO user VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('admin', 'Admin', 'admin@example.test', 1, null, '2026-11-01', '2026-11-01')
  client.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('session', '2099-01-01', 'fixture-session', '2026-11-01', '2026-11-01', null, null, 'admin')
  client.prepare('INSERT INTO account VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('account', '1234', 'github', 'admin', 'fixture-token', null, null, null, null, null, null, '2026-11-01', '2026-11-01')
  client.prepare('INSERT INTO verification VALUES (?, ?, ?, ?, ?, ?)')
    .run('state', 'identifier', 'fixture-verification', '2099-01-01', '2026-11-01', '2026-11-01')
  client.close()
}

describe('数据库结构与迁移', () => {
  it('运行时打开未初始化的数据库明确失败，不隐式创建文件', () => {
    expect(() => openDatabase(filename)).toThrow()
    expect(existsSync(filename)).toBe(false)
  })

  it('首次准备修订、发布和认证结构，约束修订来源与外键', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    const client = database.$client
    try {
      expect(client.pragma('table_info(posts)')).toEqual([
        expect.objectContaining({ name: 'id', pk: 1, notnull: 1 }),
        expect.objectContaining({ name: 'created_at', pk: 0, notnull: 1 }),
      ])
      expect(client.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(client.pragma('table_info(post_drafts)')).toEqual([
        expect.objectContaining({ name: 'post_id', pk: 1, notnull: 1 }),
        expect.objectContaining({ name: 'revision_id', notnull: 1 }),
      ])
      expect(client.pragma('table_info(post_write_receipts)')).toEqual([
        expect.objectContaining({ name: 'operation_id', pk: 1, notnull: 1 }),
        expect.objectContaining({ name: 'post_id', notnull: 1 }),
        expect.objectContaining({ name: 'request_hash', notnull: 1 }),
        expect.objectContaining({ name: 'revision_id', notnull: 1 }),
        expect.objectContaining({ name: 'publication_id', notnull: 0 }),
      ])
      expect(client.prepare('SELECT * FROM __drizzle_migrations').all())
        .toHaveLength(readMigrationFiles({ migrationsFolder: './drizzle' }).length)
      const draft = createTestDraft(createWritingStore(database),{ title: 'Draft', description: '', body: '# Draft\r\n' })
      const insert = client.prepare('INSERT INTO post_revisions (post_id, title, description, body, created_at, source) VALUES (?, ?, ?, ?, ?, ?)')
      expect(() => insert.run(draft.id, '', '', '', '2026-11-14', 'invalid')).toThrow()
      expect(() => insert.run('missing', '', '', '', '2026-11-14', 'create')).toThrow()
      expect(() => insert.run(draft.id, '', '', '', '2026-11-14', 'restore')).toThrow()
      expect(client.pragma('foreign_key_check')).toEqual([])
      expect(client.prepare("SELECT name FROM sqlite_master WHERE name = 'post_contents'").all()).toEqual([])
    } finally {
      client.close()
    }
  })

  it('重复初始化保留文章、修订、发布时间和认证数据，不重复登记迁移', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    const createdAt = new Date('2026-11-14T00:00:00Z')
    const expiresAt = new Date('2099-01-01T00:00:00Z')
    try {
      const writer = createWritingStore(database)
      const draft = createTestDraft(writer, { title: 'Published', description: 'Description', body: '# Published\r\n' })
      publishTestDraft(writer, draft)
      saveTestDraft(writer, draft, { title: 'Edited', description: '', body: '# Edited\n' })
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
      expect(reopened.prepare('SELECT * FROM __drizzle_migrations').all())
        .toHaveLength(readMigrationFiles({ migrationsFolder: './drizzle' }).length)
      expect(reopened.pragma('foreign_key_check')).toEqual([])
    } finally {
      reopened.close()
    }
  })

  it('将已有草稿和发布快照分别建立历史起点，保留身份、原文、时间及认证数据', async () => {
    createSnapshotDatabase()
    const authBefore = readContents(authTables)
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    try {
      const store = createPostStore(database)
      const unpublished = store.getDraft('draft-only')
      expect(unpublished).toMatchObject({
        id: 'draft-only', title: '  Draft  ', description: '', body: '    code\r\n\n',
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z',
      })
      expect(store.getPublishedPost('draft-only')).toBeNull()
      expect(createWritingStore(database).getDraft('draft-only')).toEqual(unpublished)
      expect(store.getDraft('modified')).toMatchObject({ title: 'Edited', body: '# New\r\n', updatedAt: '2026-11-12T00:00:00.000Z' })
      expect(store.getPublishedPost('modified')).toMatchObject({ title: 'Published', body: '# Old\n', publishedAt: '2026-11-11T00:00:00.000Z' })
      expect(store.listRevisions('modified')).toHaveLength(2)
      expect(store.listRevisions('modified').map(revision => revision.createdAt)).toEqual([
        '2026-11-12T00:00:00.000Z', '2026-11-11T00:00:00.000Z',
      ])
      expect(store.listRevisions('equal')).toHaveLength(2)
      expect(store.listRevisions('equal').every(revision => revision.source === 'migration')).toBe(true)
      expect(store.getDraft('equal')?.revisionId).not.toBe(store.getPublishedPost('equal')?.revisionId)
      expect(store.listPosts().map(post => [post.id, post.status])).toEqual([
        ['equal', 'published'], ['modified', 'modified'], ['draft-only', 'draft'],
      ])
      expect(database.$client.pragma('foreign_key_check')).toEqual([])
    } finally {
      database.$client.close()
    }
    expect(readContents(authTables)).toEqual(authBefore)
    const before = readContents()
    await initializeDatabase(filename)
    expect(readContents()).toEqual(before)
  })

  it('快照升级中途失败时完整回滚，保留原表与原文并允许重试', async () => {
    createSnapshotDatabase()
    const before = readContents(['posts', 'post_contents', ...authTables])
    const folder = join(directory, 'failed-upgrade')
    cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
    const path = join(folder, '0001_post_revisions.sql')
    const sql = readFileSync(path, 'utf8')
    writeFileSync(path, sql.replace('INSERT INTO `post_drafts`',
      "INSERT INTO missing_table VALUES (1);\n--> statement-breakpoint\nINSERT INTO `post_drafts`"))
    migration.folder = folder
    await expect(initializeDatabase(filename)).rejects.toThrow()
    expect(readContents(['posts', 'post_contents', ...authTables])).toEqual(before)
    const inspected = new Database(filename, { readonly: true })
    try {
      expect(inspected.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(1)
      expect(inspected.prepare("SELECT name FROM sqlite_master WHERE name = 'post_revisions'").all()).toEqual([])
    } finally {
      inspected.close()
    }
    migration.folder = undefined
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    try {
      expect(createPostStore(database).listPosts()).toHaveLength(3)
    } finally {
      database.$client.close()
    }
  })

  it('后续结构迁移失败时回滚数据和结构，释放连接并允许修正后重试', async () => {
    await initializeDatabase(filename)
    const database = openDatabase(filename)
    try {
      createTestDraft(createWritingStore(database),{ title: 'Existing', description: '', body: '# Existing\r\n' })
    } finally {
      database.$client.close()
    }
    const before = readContents()
    const folder = join(directory, 'migrations')
    cpSync(join(process.cwd(), 'drizzle'), folder, { recursive: true })
    const journal = readJournal(folder)
    const last = journal.entries[journal.entries.length - 1]
    const count = journal.entries.length
    journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1, tag: 'add_marker', breakpoints: true })
    writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    const sqlPath = join(folder, 'add_marker.sql')
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
      expect(inspected.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(count)
    } finally {
      inspected.close()
    }
    writeFileSync(sqlPath, 'ALTER TABLE posts ADD COLUMN marker text;')
    await initializeDatabase(filename)
    const reopened = new Database(filename, { readonly: true })
    try {
      expect(reopened.pragma('table_info(posts)')).toHaveLength(3)
      expect(reopened.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(count + 1)
    } finally {
      reopened.close()
    }
  })
})
