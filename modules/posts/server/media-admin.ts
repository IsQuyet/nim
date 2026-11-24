import { eq, like, or } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { MEDIA_PATH_PREFIX } from '@/lib/routes'
import { mediaIdSchema, type MediaAsset } from '@/modules/media/model'
import { extractMediaReferences } from '@/modules/media/server/references'
import { mediaAssets } from '@/modules/media/server/schema'
import type { MediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import type { AdminMediaItem, AdminMediaReference } from '../media'
import { postDrafts, postPublicationMedia, postPublications, postPublished, postRevisions } from './schema'

export type { AdminMediaItem, AdminMediaReference }

export type DeleteMediaResult =
  | { status: 'success'; id: string }
  | { status: 'missing' }
  | { status: 'referenced'; message: string }
  | { status: 'invalid'; message: string }

function addPostReference(
  byMedia: Map<string, Map<string, AdminMediaReference>>,
  mediaId: string,
  postId: string,
  title: string,
) {
  let posts = byMedia.get(mediaId)
  if (!posts) {
    posts = new Map()
    byMedia.set(mediaId, posts)
  }
  let entry = posts.get(postId)
  if (!entry) {
    entry = { postId, title, inDraft: false, inPublished: false, publicationCount: 0 }
    posts.set(postId, entry)
  }
  return entry
}

const draftMediaFilter = or(
  like(postRevisions.body, `%${MEDIA_PATH_PREFIX}%`),
  like(postRevisions.body, '%&#%'),
)

export function listAdminMedia(database: AppDatabase, storage: MediaStorage): AdminMediaItem[] {
  return database.transaction(transaction => {
    const assets = createMediaStore(transaction as unknown as AppDatabase, storage).list()
    if (assets.length === 0) return []

    const draftTitles = transaction.select({
      postId: postDrafts.postId,
      title: postRevisions.title,
    }).from(postDrafts)
      .innerJoin(postRevisions, eq(postRevisions.id, postDrafts.revisionId))
      .all()

    const titleByPost = new Map(draftTitles.map(draft => [draft.postId, draft.title]))
    const currentPublications = new Map(
      transaction.select({ postId: postPublished.postId, publicationId: postPublished.publicationId })
        .from(postPublished).all()
        .map(row => [row.postId, row.publicationId]),
    )

    const byMedia = new Map<string, Map<string, AdminMediaReference>>()

    const draftsWithMedia = transaction.select({
      postId: postDrafts.postId,
      title: postRevisions.title,
      body: postRevisions.body,
    }).from(postDrafts)
      .innerJoin(postRevisions, eq(postRevisions.id, postDrafts.revisionId))
      .where(draftMediaFilter)
      .all()

    for (const draft of draftsWithMedia) {
      const refs = extractMediaReferences(draft.body)
      if (refs.status !== 'success') continue
      for (const mediaId of refs.ids) {
        addPostReference(byMedia, mediaId, draft.postId, draft.title).inDraft = true
      }
    }

    const publicationRefs = transaction.select({
      mediaId: postPublicationMedia.mediaId,
      postId: postPublicationMedia.postId,
      publicationId: postPublicationMedia.publicationId,
      title: postRevisions.title,
    }).from(postPublicationMedia)
      .innerJoin(postPublications, eq(postPublications.id, postPublicationMedia.publicationId))
      .innerJoin(postRevisions, eq(postRevisions.id, postPublications.revisionId))
      .all()

    for (const row of publicationRefs) {
      const title = titleByPost.get(row.postId) ?? row.title
      const entry = addPostReference(byMedia, row.mediaId, row.postId, title)
      entry.publicationCount += 1
      if (currentPublications.get(row.postId) === row.publicationId) {
        entry.inPublished = true
      }
    }

    return assets.map(asset => {
      const refs = Array.from(byMedia.get(asset.id)?.values() ?? []).sort((left, right) => {
        if (left.inPublished !== right.inPublished) return left.inPublished ? -1 : 1
        if (left.inDraft !== right.inDraft) return left.inDraft ? -1 : 1
        return left.title.localeCompare(right.title)
      })
      return { asset, references: refs }
    })
  }, { behavior: 'deferred' })
}

export async function deleteAdminMedia(
  database: AppDatabase,
  storage: MediaStorage,
  candidateId: unknown,
): Promise<DeleteMediaResult> {
  const parsed = mediaIdSchema.safeParse(candidateId)
  if (!parsed.success) return { status: 'invalid', message: 'Invalid media ID.' }
  const id = parsed.data

  const removed = database.transaction((transaction): { status: 'deleted'; asset: MediaAsset } | Exclude<DeleteMediaResult, { status: 'success' }> => {
    const asset = createMediaStore(transaction as unknown as AppDatabase, storage).get(id)
    if (!asset) return { status: 'missing' }

    const published = transaction.select({ mediaId: postPublicationMedia.mediaId })
      .from(postPublicationMedia).where(eq(postPublicationMedia.mediaId, id)).limit(1).get()
    if (published) {
      return { status: 'referenced', message: 'This image is referenced by published posts and cannot be deleted.' }
    }

    const drafts = transaction.select({ body: postRevisions.body })
      .from(postDrafts)
      .innerJoin(postRevisions, eq(postRevisions.id, postDrafts.revisionId))
      .where(draftMediaFilter)
      .all()
    const inDraft = drafts.some(draft => {
      const refs = extractMediaReferences(draft.body)
      return refs.status === 'success' && refs.ids.includes(id)
    })
    if (inDraft) {
      return { status: 'referenced', message: 'Remove this image from drafts before deleting.' }
    }

    transaction.delete(mediaAssets).where(eq(mediaAssets.id, id)).run()
    return { status: 'deleted', asset }
  }, { behavior: 'immediate' })

  if (removed.status !== 'deleted') return removed
  await storage.remove(removed.asset)
  return { status: 'success', id }
}
