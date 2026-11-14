import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import type { AppDatabase } from './database'
import { postContentFields, postContentSchema, postIdSchema, postStatusSchema, revisionHistoryQuerySchema, REVISION_PAGE_SIZE, samePostContent } from './content'
import type {
  DraftPost,
  ImportDraftInput,
  ImportPostInput,
  PostMutationResult,
  PostContent,
  PostRevision,
  PostRevisionHistory,
  RevisionHistoryQuery,
  PostStore,
  PostSummary,
  PublishedPost,
} from './content'
import { postDrafts, postPublications, postPublished, postRevisions, posts } from './schema'

type PostDatabase = Pick<AppDatabase, 'select' | 'insert' | 'update'>

function contentOf(content: PostContent): PostContent {
  return { title: content.title, description: content.description, body: content.body }
}

function getDraft(database: PostDatabase, id: string): DraftPost | null {
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

function getPublishedPost(database: PostDatabase, id: string): PublishedPost | null {
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

function insertRevision(
  database: PostDatabase,
  postId: string,
  content: PostContent,
  source: PostRevision['source'],
  restoredFromRevisionId: number | null = null,
): PostRevision {
  return database.insert(postRevisions).values({
    postId,
    ...contentOf(content),
    createdAt: new Date().toISOString(),
    source,
    restoredFromRevisionId,
  }).returning().get()
}

function insertDraft(database: PostDatabase, id: string, content: PostContent, source: PostRevision['source']): DraftPost {
  const createdAt = new Date().toISOString()
  database.insert(posts).values({ id, createdAt }).run()
  const revision = insertRevision(database, id, content, source)
  database.insert(postDrafts).values({ postId: id, revisionId: revision.id }).run()
  return { id, revisionId: revision.id, createdAt, updatedAt: revision.createdAt, ...contentOf(content) }
}

function updateDraft(
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

function writePublication(database: PostDatabase, draft: DraftPost): PublishedPost {
  const current = getPublishedPost(database, draft.id)
  if (current?.revisionId === draft.revisionId) return current

  const publication = database.insert(postPublications).values({
    postId: draft.id,
    revisionId: draft.revisionId,
    publishedAt: new Date().toISOString(),
  }).returning().get()
  database.insert(postPublished).values({ postId: draft.id, publicationId: publication.id })
    .onConflictDoUpdate({ target: postPublished.postId, set: { publicationId: publication.id } }).run()

  return {
    id: draft.id,
    revisionId: draft.revisionId,
    publicationId: publication.id,
    createdAt: draft.createdAt,
    publishedAt: publication.publishedAt,
    ...contentOf(draft),
  }
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
  function createDraft(input: PostContent) {
    const content = postContentSchema.parse(input)
    return database.transaction(transaction => insertDraft(transaction, randomUUID(), content, 'create'), {
      behavior: 'immediate',
    })
  }

  function createDraftOnce(id: string, input: PostContent): PostMutationResult<DraftPost> {
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
      return { status: 'success', value: insertDraft(transaction, id, content, 'create') }
    }, { behavior: 'immediate' })
  }

  function saveDraft(id: string, input: PostContent, expectedRevisionId: number): PostMutationResult<DraftPost> {
    const content = postContentSchema.parse(input)
    return database.transaction((transaction): PostMutationResult<DraftPost> => {
      const draft = getDraft(transaction, id)
      if (!draft) return { status: 'missing' }
      if (draft.revisionId !== expectedRevisionId) return { status: 'conflict' }
      return { status: 'success', value: updateDraft(transaction, draft, content, 'save') }
    }, { behavior: 'immediate' })
  }

  function publishDraft(id: string, input: PostContent, expectedRevisionId: number): PostMutationResult<PublishedPost> {
    const content = postContentSchema.parse(input)
    return database.transaction((transaction): PostMutationResult<PublishedPost> => {
      const draft = getDraft(transaction, id)
      if (!draft) return { status: 'missing' }
      if (draft.revisionId !== expectedRevisionId) return { status: 'conflict' }
      const saved = updateDraft(transaction, draft, content, 'publish')
      return { status: 'success', value: writePublication(transaction, saved) }
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

  function importDraft(input: ImportDraftInput) {
    const content = postContentSchema.parse(input)
    const id = input.id ?? randomUUID()
    return database.transaction(transaction => {
      const post = transaction.select().from(posts).where(eq(posts.id, id)).get()
      if (!post) return insertDraft(transaction, id, content, 'import')
      const draft = getDraft(transaction, id)
      if (draft) return updateDraft(transaction, draft, content, 'import')
      const revision = insertRevision(transaction, id, content, 'import')
      transaction.insert(postDrafts).values({ postId: id, revisionId: revision.id }).run()
      return { id, revisionId: revision.id, createdAt: post.createdAt, updatedAt: revision.createdAt, ...content }
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
    createDraft,
    createDraftOnce,
    saveDraft,
    publishDraft,
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
