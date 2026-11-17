import { eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { samePostContent, type DraftPost, type PostContent, type PostRevision, type PublishedPost } from '../model'
import { extractMediaReferences } from '@/modules/media/server/references'
import { mediaAssets, postPublicationMedia, postDrafts, postPublications, postPublished, postRevisions, posts } from '@/lib/schema'

export type PostDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>
type PostTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

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
  return { id, revisionId: revision.id, createdAt, updatedAt: revision.createdAt, ...contentOf(content) }
}

export function updateDraft(
  database: PostDatabase,
  draft: DraftPost,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): DraftPost {
  if (samePostContent(draft, content)) return draft
  const revision = insertRevision(database, draft.id, content, source, restoredFromRevisionId)
  database.update(postDrafts).set({ revisionId: revision.id }).where(eq(postDrafts.postId, draft.id)).run()
  return { ...draft, ...contentOf(content), revisionId: revision.id, updatedAt: revision.createdAt }
}

export class InvalidPublicationMediaError extends Error {}

function publicationMediaIds(database: PostDatabase, body: string) {
  const references = extractMediaReferences(body)
  if (references.status === 'invalid') throw new InvalidPublicationMediaError(references.message)
  for (let offset = 0; offset < references.ids.length; offset += 500) {
    const batch = references.ids.slice(offset, offset + 500)
    const assets = database.select({ id: mediaAssets.id, state: mediaAssets.state })
      .from(mediaAssets).where(inArray(mediaAssets.id, batch)).all()
    if (assets.length !== batch.length || assets.some(asset => asset.state !== 'ready')) {
      throw new InvalidPublicationMediaError('Upload or repair every referenced image before publishing.')
    }
  }
  return references.ids
}

export function writePublication(database: PostTransaction, draft: DraftPost): PublishedPost {
  const mediaIds = publicationMediaIds(database, draft.body)
  const current = getPublishedPost(database, draft.id)
  let published: PublishedPost
  if (current?.revisionId === draft.revisionId) {
    published = current
  } else {
    const publication = database.insert(postPublications).values({
      postId: draft.id, revisionId: draft.revisionId, publishedAt: new Date().toISOString(),
    }).returning().get()
    database.insert(postPublished).values({ postId: draft.id, publicationId: publication.id })
      .onConflictDoUpdate({ target: postPublished.postId, set: { publicationId: publication.id } }).run()
    published = {
      id: draft.id, revisionId: draft.revisionId, publicationId: publication.id,
      createdAt: draft.createdAt, publishedAt: publication.publishedAt, ...contentOf(draft),
    }
  }
  for (const mediaId of mediaIds) {
    database.insert(postPublicationMedia).values({ postId: draft.id, publicationId: published.publicationId, mediaId })
      .onConflictDoNothing().run()
  }
  return published
}
