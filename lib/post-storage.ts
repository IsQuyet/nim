import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './database'
import { samePostContent, type DraftPost, type PostContent, type PostRevision, type PublishedPost } from './content'
import type { WorkingCopy } from './writing'
import { postDrafts, postPublications, postPublished, postRevisions, posts, postWorkingCopies } from './schema'

export type PostDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>

export function contentOf(content: PostContent): PostContent {
  return { title: content.title, description: content.description, body: content.body }
}

export function getDraft(database: PostDatabase, id: string): DraftPost | null {
  return database.select({
    id: posts.id,
    revisionId: postRevisions.id,
    createdAt: posts.createdAt,
    updatedAt: postRevisions.createdAt,
    title: postRevisions.title,
    description: postRevisions.description,
    body: postRevisions.body,
  }).from(posts).innerJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .innerJoin(postRevisions, eq(postRevisions.id, postDrafts.revisionId))
    .where(eq(posts.id, id)).get() ?? null
}

export function getWorkingCopy(database: PostDatabase, id: string): WorkingCopy | null {
  return database.select({
    id: posts.id,
    version: postWorkingCopies.version,
    checkpointRevisionId: postDrafts.revisionId,
    createdAt: posts.createdAt,
    updatedAt: postWorkingCopies.updatedAt,
    title: postWorkingCopies.title,
    description: postWorkingCopies.description,
    body: postWorkingCopies.body,
  }).from(posts).innerJoin(postWorkingCopies, eq(postWorkingCopies.postId, posts.id))
    .leftJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .where(eq(posts.id, id)).get() ?? null
}

export function writeWorkingCopy(database: PostDatabase, id: string, content: PostContent, checkpointChanged = false, updatedAt = new Date().toISOString()): WorkingCopy {
  const current = getWorkingCopy(database, id)
  const contentChanged = !current || !samePostContent(current, content)
  const values = {
    ...contentOf(content),
    version: randomUUID(),
    updatedAt: current && !contentChanged && !checkpointChanged ? current.updatedAt : updatedAt,
  }
  database.insert(postWorkingCopies).values({ postId: id, ...values })
    .onConflictDoUpdate({ target: postWorkingCopies.postId, set: values }).run()
  const written = getWorkingCopy(database, id)
  if (!written) throw new Error('无法读取已写入的工作稿。')
  return written
}

export function getPublishedPost(database: PostDatabase, id: string): PublishedPost | null {
  return database.select({
    id: posts.id,
    revisionId: postRevisions.id,
    publicationId: postPublications.id,
    createdAt: posts.createdAt,
    publishedAt: postPublications.publishedAt,
    title: postRevisions.title,
    description: postRevisions.description,
    body: postRevisions.body,
  }).from(posts).innerJoin(postPublished, eq(postPublished.postId, posts.id))
    .innerJoin(postPublications, eq(postPublications.id, postPublished.publicationId))
    .innerJoin(postRevisions, eq(postRevisions.id, postPublications.revisionId))
    .where(eq(posts.id, id)).get() ?? null
}

export function insertRevision(
  database: PostDatabase,
  postId: string,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): PostRevision {
  return database.insert(postRevisions).values({
    postId, ...contentOf(content), createdAt: new Date().toISOString(), source, restoredFromRevisionId,
  }).returning().get()
}

export function insertDraft(database: PostDatabase, id: string, content: PostContent, source: PostRevision['source']): DraftPost {
  const createdAt = new Date().toISOString()
  database.insert(posts).values({ id, createdAt }).run()
  const revision = insertRevision(database, id, content, source)
  database.insert(postDrafts).values({ postId: id, revisionId: revision.id }).run()
  writeWorkingCopy(database, id, content, false, revision.createdAt)
  return { id, revisionId: revision.id, createdAt, updatedAt: revision.createdAt, ...contentOf(content) }
}

export function updateDraft(
  database: PostDatabase,
  draft: DraftPost,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): DraftPost {
  if (samePostContent(draft, content)) {
    writeWorkingCopy(database, draft.id, content)
    return draft
  }
  const revision = insertRevision(database, draft.id, content, source, restoredFromRevisionId)
  database.update(postDrafts).set({ revisionId: revision.id }).where(eq(postDrafts.postId, draft.id)).run()
  writeWorkingCopy(database, draft.id, content, true, revision.createdAt)
  return { ...draft, ...contentOf(content), revisionId: revision.id, updatedAt: revision.createdAt }
}

export function writePublication(database: PostDatabase, draft: DraftPost): PublishedPost {
  const current = getPublishedPost(database, draft.id)
  if (current?.revisionId === draft.revisionId) return current
  const publication = database.insert(postPublications).values({
    postId: draft.id, revisionId: draft.revisionId, publishedAt: new Date().toISOString(),
  }).returning().get()
  database.insert(postPublished).values({ postId: draft.id, publicationId: publication.id })
    .onConflictDoUpdate({ target: postPublished.postId, set: { publicationId: publication.id } }).run()
  return {
    id: draft.id, revisionId: draft.revisionId, publicationId: publication.id,
    createdAt: draft.createdAt, publishedAt: publication.publishedAt, ...contentOf(draft),
  }
}
