import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { getDatabasePath } from './data-paths'

const schema = `
  CREATE TABLE posts (
    id TEXT PRIMARY KEY NOT NULL,
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

  PRAGMA user_version = 2;
`

export async function initializeDatabase(filename = getDatabasePath()) {
  mkdirSync(dirname(filename), { recursive: true })
  const database = new Database(filename)

  try {
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    const version = database.pragma('user_version', { simple: true })

    if (version === 0) {
      database.transaction(() => database.exec(schema)).immediate()
    } else if (version === 1) {
      // 重建身份表时暂时关闭外键，事务内检查快照关联，避免触发级联删除。
      database.pragma('foreign_keys = OFF')
      try {
        database.transaction(() => {
          database.exec(`
            CREATE TABLE posts_next (
              id TEXT PRIMARY KEY NOT NULL,
              created_at TEXT NOT NULL
            );
            INSERT INTO posts_next (id, created_at) SELECT id, created_at FROM posts;
            DROP TABLE posts;
            ALTER TABLE posts_next RENAME TO posts;
            PRAGMA user_version = 2;
          `)
          const violations = database.pragma('foreign_key_check') as unknown[]
          if (violations.length > 0) {
            throw new Error('数据库外键检查失败。')
          }
        }).immediate()
      } finally {
        database.pragma('foreign_keys = ON')
      }
    } else if (version !== 2) {
      throw new Error(`不支持的数据库结构版本：${version}`)
    }

    const { getMigrations } = await import('better-auth/db/migration')
    const { runMigrations } = await getMigrations({ database })
    await runMigrations()
  } finally {
    database.close()
  }
}

export function openDatabase(filename = getDatabasePath()) {
  const database = new Database(filename, { fileMustExist: true })
  database.pragma('foreign_keys = ON')
  return database
}
