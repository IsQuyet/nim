import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { AppDatabase } from './database'
import { postContents, posts } from './schema'

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

function getDraft(database: Pick<AppDatabase, 'select'>, id: string) {
  return database.select({
    id: posts.id,
    createdAt: posts.createdAt,
    title: postContents.title,
    description: postContents.description,
    body: postContents.body,
    updatedAt: postContents.updatedAt,
  }).from(posts).innerJoin(postContents, and(
    eq(postContents.postId, posts.id),
    eq(postContents.stage, 'draft'),
  )).where(eq(posts.id, id)).get() ?? null
}

function insertDraft(database: Pick<AppDatabase, 'insert'>, id: string, content: PostContent): DraftPost {
  const fields = { title: content.title, description: content.description, body: content.body }
  const now = new Date().toISOString()
  database.insert(posts).values({ id, createdAt: now }).run()
  database.insert(postContents).values({
    postId: id,
    stage: 'draft',
    ...fields,
    updatedAt: now,
  }).run()

  return { id, createdAt: now, updatedAt: now, ...fields }
}

function writePublished(database: Pick<AppDatabase, 'insert'>, draft: DraftPost): PublishedPost {
  const publishedAt = new Date().toISOString()
  const content = { title: draft.title, description: draft.description, body: draft.body }
  database.insert(postContents).values({
    postId: draft.id,
    stage: 'published',
    ...content,
    updatedAt: publishedAt,
  }).onConflictDoUpdate({
    target: [postContents.postId, postContents.stage],
    set: { ...content, updatedAt: publishedAt },
  }).run()

  return { id: draft.id, createdAt: draft.createdAt, publishedAt, ...content }
}

export function importPublishedPosts(database: AppDatabase, inputs: ImportPostInput[]) {
  return database.transaction(transaction => {
    let imported = 0
    let skipped = 0

    for (const input of inputs) {
      const existing = transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, input.id)).get()
      if (existing) {
        skipped += 1
        continue
      }

      const content = { title: input.title, description: input.description, body: input.body }
      const draft = insertDraft(transaction, input.id, content)
      writePublished(transaction, draft)
      imported += 1
    }

    return { imported, skipped }
  }, { behavior: 'immediate' })
}

export function createPostStore(database: AppDatabase) {
  const draft = alias(postContents, 'draft')
  const published = alias(postContents, 'published')

  function createDraft(content: PostContent) {
    return database.transaction(transaction => {
      return insertDraft(transaction, randomUUID(), content)
    }, { behavior: 'immediate' })
  }

  function saveDraft(id: string, content: PostContent): DraftPost {
    const fields = { title: content.title, description: content.description, body: content.body }
    return database.transaction(transaction => {
      const draft = getDraft(transaction, id)
      if (!draft) throw new Error('草稿不存在。')

      const updatedAt = new Date().toISOString()
      transaction.update(postContents).set({ ...fields, updatedAt }).where(and(
        eq(postContents.postId, id),
        eq(postContents.stage, 'draft'),
      )).run()
      return { ...draft, ...fields, updatedAt }
    }, { behavior: 'immediate' })
  }

  function publishDraft(id: string) {
    return database.transaction(transaction => {
      const draft = getDraft(transaction, id)
      if (!draft) throw new Error('草稿不存在。')

      return writePublished(transaction, draft)
    }, { behavior: 'immediate' })
  }

  function getPublishedPost(id: string) {
    return database.select({
      id: posts.id,
      createdAt: posts.createdAt,
      title: postContents.title,
      description: postContents.description,
      body: postContents.body,
      publishedAt: postContents.updatedAt,
    }).from(posts).innerJoin(postContents, and(
      eq(postContents.postId, posts.id),
      eq(postContents.stage, 'published'),
    )).where(eq(posts.id, id)).get() ?? null
  }

  function listPosts() {
    return database.select({
      id: posts.id,
      title: draft.title,
      description: draft.description,
      updatedAt: draft.updatedAt,
      status: sql<PostSummary['status']>`case
        when ${published.postId} is null then 'draft'
        when (${draft.title}, ${draft.description}, ${draft.body}) =
             (${published.title}, ${published.description}, ${published.body}) then 'published'
        else 'modified'
      end`,
    }).from(posts).innerJoin(draft, and(
      eq(draft.postId, posts.id),
      eq(draft.stage, 'draft'),
    )).leftJoin(published, and(
      eq(published.postId, posts.id),
      eq(published.stage, 'published'),
    )).orderBy(desc(draft.updatedAt), asc(posts.id)).all()
  }

  function listPublishedPosts() {
    return database.select({
      id: posts.id,
      title: postContents.title,
      description: postContents.description,
      publishedAt: postContents.updatedAt,
    }).from(posts).innerJoin(postContents, and(
      eq(postContents.postId, posts.id),
      eq(postContents.stage, 'published'),
    )).orderBy(desc(postContents.updatedAt), asc(posts.id)).all()
  }

  return {
    createDraft,
    saveDraft,
    publishDraft,
    getDraft: (id: string) => getDraft(database, id),
    getPublishedPost,
    listPosts,
    listPublishedPosts,
  }
}
