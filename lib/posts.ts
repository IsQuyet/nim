import { randomUUID } from 'node:crypto'
import type { Database } from 'better-sqlite3'

export type PostContent = {
  title: string
  description: string
  body: string
}

export type CreateDraftInput = PostContent & {
  slug: string
}

export type DraftPost = PostContent & {
  id: string
  slug: string
  createdAt: string
  updatedAt: string
}

export type PublishedPost = PostContent & {
  id: string
  slug: string
  createdAt: string
  publishedAt: string
}

export type PublishedPostSummary = Pick<
  PublishedPost,
  'id' | 'slug' | 'title' | 'description' | 'publishedAt'
>

export function importPublishedPosts(database: Database, posts: CreateDraftInput[]) {
  const store = createPostStore(database)
  const selectExisting = database.prepare<[string], { id: string }>(
    'SELECT id FROM posts WHERE slug = ?',
  )

  return database.transaction(() => {
    let imported = 0
    let skipped = 0

    for (const post of posts) {
      if (selectExisting.get(post.slug)) {
        skipped += 1
        continue
      }

      const draft = store.createDraft(post)
      store.publishDraft(draft.id)
      imported += 1
    }

    return { imported, skipped }
  }).immediate()
}

export function createPostStore(database: Database) {
  const selectDraft = database.prepare<[string], DraftPost>(`
    SELECT p.id, p.slug, p.created_at AS createdAt,
      c.title, c.description, c.body, c.updated_at AS updatedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'draft'
    WHERE p.id = ?
  `)
  const selectPublished = database.prepare<[string], PublishedPost>(`
    SELECT p.id, p.slug, p.created_at AS createdAt,
      c.title, c.description, c.body, c.updated_at AS publishedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'published'
    WHERE p.slug = ?
  `)
  const selectPublishedList = database.prepare<[], PublishedPostSummary>(`
    SELECT p.id, p.slug, c.title, c.description, c.updated_at AS publishedAt
    FROM posts p
    JOIN post_contents c ON c.post_id = p.id AND c.stage = 'published'
    ORDER BY c.updated_at DESC, p.id ASC
  `)
  const insertPost = database.prepare(`
    INSERT INTO posts (id, slug, created_at) VALUES (?, ?, ?)
  `)
  const insertDraft = database.prepare(`
    INSERT INTO post_contents (post_id, stage, title, description, body, updated_at)
    VALUES (?, 'draft', ?, ?, ?, ?)
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

  function getPublishedPost(slug: string) {
    return selectPublished.get(slug) ?? null
  }

  const createDraft = database.transaction((input: CreateDraftInput): DraftPost => {
    const id = randomUUID()
    const now = new Date().toISOString()
    insertPost.run(id, input.slug, now)
    insertDraft.run(id, input.title, input.description, input.body, now)

    return {
      id,
      slug: input.slug,
      title: input.title,
      description: input.description,
      body: input.body,
      createdAt: now,
      updatedAt: now,
    }
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
      slug: draft.slug,
      title: draft.title,
      description: draft.description,
      body: draft.body,
      createdAt: draft.createdAt,
      publishedAt,
    }
  }).immediate

  function listPublishedPosts() {
    return selectPublishedList.all()
  }

  return {
    createDraft,
    saveDraft,
    publishDraft,
    getDraft,
    getPublishedPost,
    listPublishedPosts,
  }
}
