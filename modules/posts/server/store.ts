import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { AppDatabase } from '@/lib/server/database'
import { revisionHistoryQuerySchema, REVISION_PAGE_SIZE, type PostRevisionHistory, type RevisionHistoryQuery } from '../history'
import { identifiedPostContentSchema, postContentFields, postContentSchema, postIdSchema, postStatusSchema, samePostContent } from '../model'
import type {
  DraftPost,
  ImportPostInput,
  PostMutationResult,
  PostContent,
  PostPublication,
  PostRevision,
  PublishedPost,
  PublishedPostSummary,
  PostSummary,
} from '../model'
import { postDrafts, postPublications, postPublished, postRevisions, posts } from './schema'
import { getDraft, getPublishedPost, insertDraft, updateDraft, writePublication } from './storage'

export type PostStore = {
  createImportedDraftOnce(id: string, content: PostContent): Promise<PostMutationResult<DraftPost>>
  restoreRevision(id: string, revisionId: number, expectedRevisionId: number): Promise<PostMutationResult<DraftPost>>
  importDraft(input: ImportPostInput): Promise<DraftPost>
  getDraft(id: string): Promise<DraftPost | null>
  getPublishedPost(id: string): Promise<PublishedPost | null>
  getRevision(id: string, revisionId: number): Promise<PostRevision | null>
  getRevisionHistory(id: string, query?: RevisionHistoryQuery): Promise<PostRevisionHistory | null>
  listRevisions(id: string): Promise<PostRevision[]>
  listPublications(id: string): Promise<PostPublication[]>
  listPosts(): Promise<PostSummary[]>
  listPublishedPosts(): Promise<PublishedPostSummary[]>
}

export async function importPublishedPosts(database: AppDatabase, inputs: ImportPostInput[]) {
  return database.transaction(async transaction => {
    let imported = 0
    let skipped = 0
    for (const input of inputs) {
      const id = postIdSchema.parse(input.id)
      const content = postContentSchema.parse(input)
      const [existing] = await transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).for('update')
      if (existing) {
        skipped += 1
        continue
      }
      const draft = await insertDraft(transaction, id, content, 'import')
      await writePublication(transaction, draft)
      imported += 1
    }
    return { imported, skipped }
  })
}

export function createPostStore(database: AppDatabase): PostStore {
  async function createImportedDraftOnce(id: string, input: PostContent): Promise<PostMutationResult<DraftPost>> {
    postIdSchema.parse(id)
    const content = postContentSchema.parse(input)
    return database.transaction(async (transaction): Promise<PostMutationResult<DraftPost>> => {
      const [existing] = await transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).for('update')
      if (existing) {
        const draft = await getDraft(transaction, id)
        return draft && samePostContent(draft, content)
          ? { status: 'success', value: draft }
          : { status: 'conflict' }
      }
      return { status: 'success', value: await insertDraft(transaction, id, content, 'import') }
    })
  }

  async function getRevision(id: string, revisionId: number) {
    const [row] = await database.select().from(postRevisions).where(and(
      eq(postRevisions.postId, id), eq(postRevisions.id, revisionId),
    )).limit(1)
    return row ?? null
  }

  async function restoreRevision(id: string, revisionId: number, expectedRevisionId: number): Promise<PostMutationResult<DraftPost>> {
    return database.transaction(async (transaction): Promise<PostMutationResult<DraftPost>> => {
      await transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).for('update')
      const draft = await getDraft(transaction, id)
      if (!draft) return { status: 'missing' }
      if (draft.revisionId !== expectedRevisionId) return { status: 'conflict' }
      const [revision] = await transaction.select().from(postRevisions).where(and(
        eq(postRevisions.postId, id), eq(postRevisions.id, revisionId),
      )).limit(1)
      if (!revision) return { status: 'missing' }
      return { status: 'success', value: await updateDraft(transaction, draft, revision, 'restore', revision.id) }
    })
  }

  async function importDraft(input: ImportPostInput) {
    const content = postContentSchema.parse(input)
    const id = identifiedPostContentSchema.shape.id.parse(input.id)
    return database.transaction(async transaction => {
      const [post] = await transaction.select().from(posts).where(eq(posts.id, id)).for('update')
      if (!post) return insertDraft(transaction, id, content, 'import')
      const draft = await getDraft(transaction, id)
      if (!draft) throw new Error('文章身份缺少草稿修订。')
      return updateDraft(transaction, draft, content, 'import')
    })
  }

  async function getRevisionHistory(id: string, query: RevisionHistoryQuery = revisionHistoryQuerySchema.parse({})): Promise<PostRevisionHistory | null> {
    return database.transaction(async transaction => {
      const draft = await getDraft(transaction, id)
      if (!draft) return null
      const [total] = await transaction.select({ value: count() }).from(postRevisions)
        .where(eq(postRevisions.postId, id))
      if (!total) throw new Error('无法读取文章修订数量。')
      const pageCount = Math.ceil(total.value / REVISION_PAGE_SIZE)
      if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > pageCount) return null
      const [selectedRevision] = await transaction.select().from(postRevisions).where(and(
        eq(postRevisions.postId, id), eq(postRevisions.id, query.revisionId ?? draft.revisionId),
      )).limit(1)
      if (!selectedRevision) return null
      const revisions = await transaction.select({
        id: postRevisions.id,
        postId: postRevisions.postId,
        title: postRevisions.title,
        createdAt: postRevisions.createdAt,
        source: postRevisions.source,
        restoredFromRevisionId: postRevisions.restoredFromRevisionId,
      }).from(postRevisions).where(eq(postRevisions.postId, id))
        .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id))
        .limit(REVISION_PAGE_SIZE).offset((query.page - 1) * REVISION_PAGE_SIZE)
      return {
        draft,
        published: await getPublishedPost(transaction, id),
        selectedRevision,
        revisions,
        page: query.page,
        pageCount,
        revisionCount: total.value,
      }
    })
  }

  async function listPosts() {
    const draft = alias(postRevisions, 'draft')
    const published = alias(postRevisions, 'published')
    return database.select({
      id: posts.id,
      title: draft.title,
      description: draft.description,
      updatedAt: draft.createdAt,
      status: sql<PostSummary['status']>`case
        when ${postPublished.publicationId} is null then ${postStatusSchema.enum.draft}
        when ${and(...postContentFields.map(field => eq(draft[field], published[field])))} then ${postStatusSchema.enum.published}
        else ${postStatusSchema.enum.modified}
      end`,
    }).from(posts).innerJoin(postDrafts, eq(postDrafts.postId, posts.id))
      .innerJoin(draft, eq(draft.id, postDrafts.revisionId))
      .leftJoin(postPublished, eq(postPublished.postId, posts.id))
      .leftJoin(postPublications, eq(postPublications.id, postPublished.publicationId))
      .leftJoin(published, eq(published.id, postPublications.revisionId))
      .orderBy(desc(draft.createdAt), asc(posts.id))
  }

  async function listPublishedPosts() {
    return database.select({
      id: posts.id,
      title: postRevisions.title,
      description: postRevisions.description,
      publishedAt: postPublications.publishedAt,
    }).from(posts).innerJoin(postPublished, eq(postPublished.postId, posts.id))
      .innerJoin(postPublications, eq(postPublications.id, postPublished.publicationId))
      .innerJoin(postRevisions, eq(postRevisions.id, postPublications.revisionId))
      .orderBy(desc(postPublications.publishedAt), asc(posts.id))
  }

  return {
    createImportedDraftOnce,
    restoreRevision,
    importDraft,
    getDraft: id => getDraft(database, id),
    getPublishedPost: id => getPublishedPost(database, id),
    getRevision,
    getRevisionHistory,
    listRevisions: id => database.select().from(postRevisions).where(eq(postRevisions.postId, id))
      .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id)),
    listPublications: id => database.select().from(postPublications).where(eq(postPublications.postId, id))
      .orderBy(desc(postPublications.id)),
    listPosts,
    listPublishedPosts,
  }
}

export type PublishedPostSearchDocument = {
  id: string
  title: string
  description: string
  body: string
  publishedAt: string
}

/** 查询所有公开版本文章及其正文，供跨内容站内检索使用。 */
export async function listPublishedPostDocuments(database: Pick<AppDatabase, 'select'>): Promise<PublishedPostSearchDocument[]> {
  return database.select({
    id: posts.id,
    title: postRevisions.title,
    description: postRevisions.description,
    body: postRevisions.body,
    publishedAt: postPublications.publishedAt,
  }).from(posts)
    .innerJoin(postPublished, eq(postPublished.postId, posts.id))
    .innerJoin(postPublications, eq(postPublications.id, postPublished.publicationId))
    .innerJoin(postRevisions, eq(postRevisions.id, postPublications.revisionId))
    .orderBy(desc(postPublications.publishedAt), asc(posts.id))
}
