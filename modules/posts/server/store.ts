import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
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
  createImportedDraftOnce(id: string, content: PostContent): PostMutationResult<DraftPost>
  restoreRevision(id: string, revisionId: number, expectedRevisionId: number): PostMutationResult<DraftPost>
  importDraft(input: ImportPostInput): DraftPost
  getDraft(id: string): DraftPost | null
  getPublishedPost(id: string): PublishedPost | null
  getRevision(id: string, revisionId: number): PostRevision | null
  getRevisionHistory(id: string, query?: RevisionHistoryQuery): PostRevisionHistory | null
  listRevisions(id: string): PostRevision[]
  listPublications(id: string): PostPublication[]
  listPosts(): PostSummary[]
  listPublishedPosts(): PublishedPostSummary[]
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
      const content = postContentSchema.parse(input)
      const draft = insertDraft(transaction, input.id, content, 'import')
      writePublication(transaction, draft)
      imported += 1
    }
    return { imported, skipped }
  }, { behavior: 'immediate' })
}

export function createPostStore(database: AppDatabase): PostStore {
  function createImportedDraftOnce(id: string, input: PostContent): PostMutationResult<DraftPost> {
    postIdSchema.parse(id)
    const content = postContentSchema.parse(input)
    return database.transaction((transaction): PostMutationResult<DraftPost> => {
      const existing = transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, id)).get()
      if (existing) {
        const draft = getDraft(transaction, id)
        return draft && samePostContent(draft, content)
          ? { status: 'success', value: draft }
          : { status: 'conflict' }
      }
      return { status: 'success', value: insertDraft(transaction, id, content, 'import') }
    }, { behavior: 'immediate' })
  }

  function getRevision(id: string, revisionId: number) {
    return database.select().from(postRevisions).where(and(
      eq(postRevisions.postId, id), eq(postRevisions.id, revisionId),
    )).get() ?? null
  }

  function restoreRevision(id: string, revisionId: number, expectedRevisionId: number): PostMutationResult<DraftPost> {
    return database.transaction((transaction): PostMutationResult<DraftPost> => {
      const draft = getDraft(transaction, id)
      if (!draft) return { status: 'missing' }
      if (draft.revisionId !== expectedRevisionId) return { status: 'conflict' }
      const revision = transaction.select().from(postRevisions).where(and(
        eq(postRevisions.postId, id), eq(postRevisions.id, revisionId),
      )).get()
      if (!revision) return { status: 'missing' }
      return { status: 'success', value: updateDraft(transaction, draft, revision, 'restore', revision.id) }
    }, { behavior: 'immediate' })
  }

  function importDraft(input: ImportPostInput) {
    const content = postContentSchema.parse(input)
    const id = identifiedPostContentSchema.shape.id.parse(input.id)
    return database.transaction(transaction => {
      const post = transaction.select().from(posts).where(eq(posts.id, id)).get()
      if (!post) return insertDraft(transaction, id, content, 'import')
      const draft = getDraft(transaction, id)
      if (!draft) throw new Error('文章身份缺少草稿修订。')
      return updateDraft(transaction, draft, content, 'import')
    }, { behavior: 'immediate' })
  }

  function getRevisionHistory(id: string, query: RevisionHistoryQuery = revisionHistoryQuerySchema.parse({})): PostRevisionHistory | null {
    return database.transaction(transaction => {
      const draft = getDraft(transaction, id)
      if (!draft) return null
      const total = transaction.select({ value: count() }).from(postRevisions)
        .where(eq(postRevisions.postId, id)).get()
      if (!total) throw new Error('无法读取文章修订数量。')
      const pageCount = Math.ceil(total.value / REVISION_PAGE_SIZE)
      if (!Number.isSafeInteger(query.page) || query.page < 1 || query.page > pageCount) return null
      const selectedRevision = transaction.select().from(postRevisions).where(and(
        eq(postRevisions.postId, id), eq(postRevisions.id, query.revisionId ?? draft.revisionId),
      )).get()
      if (!selectedRevision) return null
      const revisions = transaction.select({
        id: postRevisions.id,
        postId: postRevisions.postId,
        title: postRevisions.title,
        createdAt: postRevisions.createdAt,
        source: postRevisions.source,
        restoredFromRevisionId: postRevisions.restoredFromRevisionId,
      }).from(postRevisions).where(eq(postRevisions.postId, id))
        .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id))
        .limit(REVISION_PAGE_SIZE).offset((query.page - 1) * REVISION_PAGE_SIZE).all()
      return {
        draft,
        published: getPublishedPost(transaction, id),
        selectedRevision,
        revisions,
        page: query.page,
        pageCount,
        revisionCount: total.value,
      }
    }, { behavior: 'deferred' })
  }

  function listPosts() {
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
      .orderBy(desc(draft.createdAt), asc(posts.id)).all()
  }

  function listPublishedPosts() {
    return database.select({
      id: posts.id,
      title: postRevisions.title,
      description: postRevisions.description,
      publishedAt: postPublications.publishedAt,
    }).from(posts).innerJoin(postPublished, eq(postPublished.postId, posts.id))
      .innerJoin(postPublications, eq(postPublications.id, postPublished.publicationId))
      .innerJoin(postRevisions, eq(postRevisions.id, postPublications.revisionId))
      .orderBy(desc(postPublications.publishedAt), asc(posts.id)).all()
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
      .orderBy(desc(postRevisions.createdAt), desc(postRevisions.id)).all(),
    listPublications: id => database.select().from(postPublications).where(eq(postPublications.postId, id))
      .orderBy(desc(postPublications.id)).all(),
    listPosts,
    listPublishedPosts,
  }
}
