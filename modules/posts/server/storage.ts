import { eq, inArray } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { samePostContent, type DraftPost, type PostContent, type PostRevision, type PublishedPost } from '../model'
import { extractMediaReferences } from '@/modules/media/server/references'
import { mediaAssets } from '@/modules/media/server/schema'
import { postPublicationMedia, postDrafts, postPublications, postPublished, postRevisions, posts } from './schema'

export type PostDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>
type PostTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0]

export function contentOf(content: PostContent): PostContent {
  return { title: content.title, description: content.description, body: content.body }
}

export async function getDraft(database: PostDatabase, id: string): Promise<DraftPost | null> {
  const [row] = await database.select({
    id: posts.id,
    revisionId: postRevisions.id,
    createdAt: posts.createdAt,
    updatedAt: postRevisions.createdAt,
    title: postRevisions.title,
    description: postRevisions.description,
    body: postRevisions.body,
  }).from(posts).innerJoin(postDrafts, eq(postDrafts.postId, posts.id))
    .innerJoin(postRevisions, eq(postRevisions.id, postDrafts.revisionId))
    .where(eq(posts.id, id)).limit(1)
  return row ?? null
}

export async function getPublishedPost(database: PostDatabase, id: string): Promise<PublishedPost | null> {
  const [row] = await database.select({
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
    .where(eq(posts.id, id)).limit(1)
  return row ?? null
}

export async function insertRevision(
  database: PostDatabase,
  postId: string,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): Promise<PostRevision> {
  const [revision] = await database.insert(postRevisions).values({
    postId, ...contentOf(content), createdAt: new Date().toISOString(), source, restoredFromRevisionId,
  }).returning()
  return revision
}

export async function insertDraft(database: PostDatabase, id: string, content: PostContent, source: PostRevision['source']): Promise<DraftPost> {
  const createdAt = new Date().toISOString()
  await database.insert(posts).values({ id, createdAt })
  const revision = await insertRevision(database, id, content, source)
  await database.insert(postDrafts).values({ postId: id, revisionId: revision.id })
  return { id, revisionId: revision.id, createdAt, updatedAt: revision.createdAt, ...contentOf(content) }
}

export async function updateDraft(
  database: PostDatabase,
  draft: DraftPost,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): Promise<DraftPost> {
  if (samePostContent(draft, content)) return draft
  const revision = await insertRevision(database, draft.id, content, source, restoredFromRevisionId)
  await database.update(postDrafts).set({ revisionId: revision.id }).where(eq(postDrafts.postId, draft.id))
  return { ...draft, ...contentOf(content), revisionId: revision.id, updatedAt: revision.createdAt }
}

export class InvalidPublicationMediaError extends Error {}

async function publicationMediaIds(database: PostDatabase, body: string) {
  const references = extractMediaReferences(body)
  if (references.status === 'invalid') throw new InvalidPublicationMediaError(references.message)
  for (let offset = 0; offset < references.ids.length; offset += 500) {
    const batch = references.ids.slice(offset, offset + 500)
    const assets = await database.select({ id: mediaAssets.id, state: mediaAssets.state })
      .from(mediaAssets).where(inArray(mediaAssets.id, batch))
    if (assets.length !== batch.length || assets.some(asset => asset.state !== 'ready')) {
      throw new InvalidPublicationMediaError('Upload or repair every referenced image before publishing.')
    }
  }
  return references.ids
}

export async function isMediaPublished(database: PostDatabase, mediaId: string) {
  const [row] = await database.select({ mediaId: postPublicationMedia.mediaId })
    .from(postPublicationMedia).where(eq(postPublicationMedia.mediaId, mediaId)).limit(1)
  return row !== undefined
}

export async function writePublication(database: PostTransaction, draft: DraftPost): Promise<PublishedPost> {
  const mediaIds = await publicationMediaIds(database, draft.body)
  const current = await getPublishedPost(database, draft.id)
  let published: PublishedPost
  if (current?.revisionId === draft.revisionId) {
    published = current
  } else {
    const [publication] = await database.insert(postPublications).values({
      postId: draft.id, revisionId: draft.revisionId, publishedAt: new Date().toISOString(),
    }).returning()
    await database.insert(postPublished).values({ postId: draft.id, publicationId: publication.id })
      .onConflictDoUpdate({ target: postPublished.postId, set: { publicationId: publication.id } })
    published = {
      id: draft.id, revisionId: draft.revisionId, publicationId: publication.id,
      createdAt: draft.createdAt, publishedAt: publication.publishedAt, ...contentOf(draft),
    }
  }
  if (mediaIds.length > 0) {
    await database.insert(postPublicationMedia)
      .values(mediaIds.map(mediaId => ({ postId: draft.id, publicationId: published.publicationId, mediaId })))
      .onConflictDoNothing()
  }
  return published
}
