// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase } from './database'

let directory: string
let filename: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-database-'))
  filename = join(directory, 'nim.sqlite')
})

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true })
})

function createVersionOne() {
  const database = new Database(filename)
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE posts (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE post_contents (
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('draft', 'published')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (post_id, stage)
    );
    PRAGMA user_version = 1;
  `)
  return database
}

function getColumns(database: Database.Database) {
  const columns = database.pragma('table_info(posts)') as { name: string }[]
  return columns.map(column => column.name)
}

describe('文章身份数据库结构', () => {
  it('新库只保存文章 ID 和创建时间，重复准备保持同一结构', () => {
    initializeDatabase(filename)
    initializeDatabase(filename)
    const database = openDatabase(filename)

    try {
      expect(database.pragma('user_version', { simple: true })).toBe(2)
      expect(getColumns(database)).toEqual(['id', 'created_at'])
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    } finally {
      database.close()
    }
  })

  it('升级保留文章 ID、创建时间及完整的草稿和发布快照', () => {
    const database = createVersionOne()
    const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    const createdAt = '2026-11-13T04:17:13.397Z'
    database.prepare('INSERT INTO posts VALUES (?, ?, ?)').run(id, 'first-post', createdAt)
    const insert = database.prepare('INSERT INTO post_contents VALUES (?, ?, ?, ?, ?, ?)')
    insert.run(id, 'draft', 'Edited title', 'Edited description.', '# Edited body\r\n', '2026-11-13T12:00:00Z')
    insert.run(id, 'published', 'Published title', 'Published description.', '# Published body\n', createdAt)
    const contents = database.prepare('SELECT * FROM post_contents ORDER BY stage').all()
    database.close()

    initializeDatabase(filename)
    initializeDatabase(filename)
    const reopened = openDatabase(filename)

    try {
      expect(reopened.pragma('user_version', { simple: true })).toBe(2)
      expect(getColumns(reopened)).toEqual(['id', 'created_at'])
      expect(reopened.prepare('SELECT * FROM posts').all()).toEqual([{ id, created_at: createdAt }])
      expect(reopened.prepare('SELECT * FROM post_contents ORDER BY stage').all()).toEqual(contents)
      expect(reopened.pragma('foreign_key_check')).toEqual([])
    } finally {
      reopened.close()
    }
  })

  it('外键检查失败时回滚整个升级，不改变已有结构和内容', () => {
    const database = createVersionOne()
    database.prepare('INSERT INTO post_contents VALUES (?, ?, ?, ?, ?, ?)')
      .run('missing-post', 'draft', 'Draft title', '', '# Draft', '2026-11-13T00:00:00Z')
    const columns = getColumns(database)
    const contents = database.prepare('SELECT * FROM post_contents').all()
    database.close()

    expect(() => initializeDatabase(filename)).toThrow('数据库外键检查失败')
    const reopened = new Database(filename)
    try {
      expect(reopened.pragma('user_version', { simple: true })).toBe(1)
      expect(getColumns(reopened)).toEqual(columns)
      expect(reopened.prepare('SELECT * FROM post_contents').all()).toEqual(contents)
    } finally {
      reopened.close()
    }
  })
})
