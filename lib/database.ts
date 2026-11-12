import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

const schema = `
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
`

export function getDatabasePath() {
  return resolve(process.env.DATABASE_PATH?.trim() || '.data/nim.sqlite')
}

export function initializeDatabase(filename = getDatabasePath()) {
  mkdirSync(dirname(filename), { recursive: true })
  const database = new Database(filename)

  try {
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    const version = database.pragma('user_version', { simple: true })

    if (version === 0) {
      database.transaction(() => database.exec(schema)).immediate()
    } else if (version !== 1) {
      throw new Error(`不支持的数据库结构版本：${version}`)
    }
  } finally {
    database.close()
  }
}

export function openDatabase(filename = getDatabasePath()) {
  const database = new Database(filename, { fileMustExist: true })
  database.pragma('foreign_keys = ON')
  return database
}
