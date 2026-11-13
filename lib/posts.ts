import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

export type PostContent = {
  title: string
  description: string
  body: string
}

export type DraftPost = PostContent & {
  id: string
  createdAt: string
  updatedAt: string
}

export type PublishedPost = PostContent & {
  id: string
  createdAt: string
  publishedAt: string
}

export type PublishedPostSummary = Pick<
  PublishedPost,
  'id' | 'title' | 'description' | 'publishedAt'
>

export type PostSummary = Pick<
  DraftPost,
  'id' | 'title' | 'description' | 'updatedAt'
> & {
  status: 'draft' | 'published' | 'modified'
}

export type ImportPostInput = PostContent & {
  id: string
}

function insertDraft(database: Database, id: string, content: PostContent): DraftPost {
  const now = new Date().toISOString()
  database.prepare('INSERT INTO posts (id, created_at) VALUES (?, ?)').run(id, now)
  database.prepare(`
    INSERT INTO post_contents (post_id, stage, title, description, body, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?)
  `).run(id, content.title, content.description, content.body, now)

  return {
    id,
    title: content.title,
    description: content.description,
    body: content.body,
    createdAt: now,
    updatedAt: now,
  }
}

export function importPublishedPosts(database: Database, posts: ImportPostInput[]) {
  const store = createPostStore(database)
  const selectExisting = database.prepare<[string], { id: string }>(
    'SELECT id FROM posts WHERE id = ?',
  )

  return database.transaction(() => {
    let imported = 0
    let skipped = 0

    for (const post of posts) {
      if (selectExisting.get(post.id)) {
        skipped += 1
        continue
      }

      const draft = insertDraft(database, post.id, post)
      store.publishDraft(draft.id)
      imported += 1
    }

    return { imported, skipped }
  }).immediate()
}

export function createPostStore(database: Database) {
  const selectDraft = database.prepare<[string], DraftPost>(`
    SELECT p.id, p.created_at AS createdAt,
      c.title, c.description, c.body, c.updated_at AS updatedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'draft'
    WHERE p.id = ?
  `)
  const selectPostList = database.prepare<[], PostSummary>(`
    SELECT p.id, d.title, d.description, d.updated_at AS updatedAt,
      CASE
        WHEN c.post_id IS NULL THEN 'draft'
        WHEN (d.title, d.description, d.body) = (c.title, c.description, c.body) THEN 'published'
        ELSE 'modified'
      END AS status
    FROM posts p
    JOIN post_contents d ON d.post_id = p.id AND d.stage = 'draft'
    LEFT JOIN post_contents c ON c.post_id = p.id AND c.stage = 'published'
    ORDER BY d.updated_at DESC, p.id ASC
  `)
  const selectPublished = database.prepare<[string], PublishedPost>(`
    SELECT p.id, p.created_at AS createdAt,
      c.title, c.description, c.body, c.updated_at AS publishedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'published'
    WHERE p.id = ?
  `)
  const selectPublishedList = database.prepare<[], PublishedPostSummary>(`
    SELECT p.id, c.title, c.description, c.updated_at AS publishedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'published'
    ORDER BY c.updated_at DESC, p.id ASC
  `)
  const updateDraft = database.prepare(`
    UPDATE post_contents SET title = ?, description = ?, body = ?, updated_at = ?
    WHERE post_id = ? AND stage = 'draft'
  `)
  const writePublished = database.prepare(`
    INSERT INTO post_contents (post_id, stage, title, description, body, updated_at)
    VALUES (?, 'published', ?, ?, ?, ?)
    ON CONFLICT (post_id, stage) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      body = excluded.body,
      updated_at = excluded.updated_at
  `)

  function getDraft(id: string) {
    return selectDraft.get(id) ?? null
  }

  function getPublishedPost(id: string) {
    return selectPublished.get(id) ?? null
  }

  const createDraft = database.transaction((content: PostContent): DraftPost => {
    return insertDraft(database, randomUUID(), content)
  }).immediate

  const saveDraft = database.transaction((id: string, content: PostContent): DraftPost => {
    const draft = getDraft(id)
    if (!draft) throw new Error('草稿不存在。')

    const updatedAt = new Date().toISOString()
    updateDraft.run(content.title, content.description, content.body, updatedAt, id)
    return {
      ...draft,
      title: content.title,
      description: content.description,
      body: content.body,
      updatedAt,
    }
  }).immediate

  const publishDraft = database.transaction((id: string): PublishedPost => {
    const draft = getDraft(id)
    if (!draft) throw new Error('草稿不存在。')

    const publishedAt = new Date().toISOString()
    writePublished.run(id, draft.title, draft.description, draft.body, publishedAt)

    return {
      id: draft.id,
      title: draft.title,
      description: draft.description,
      body: draft.body,
      createdAt: draft.createdAt,
      publishedAt,
    }
  }).immediate

  function listPosts() {
    return selectPostList.all()
  }

  function listPublishedPosts() {
    return selectPublishedList.all()
  }

  return {
    createDraft,
    saveDraft,
    publishDraft,
    getDraft,
    getPublishedPost,
    listPosts,
    listPublishedPosts,
  }
}
