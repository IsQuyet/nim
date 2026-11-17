import { z } from 'zod'

const text = z.string({ error: 'The draft fields must contain text.' })

export const postFieldsSchema = z.object({
  title: text,
  description: text,
  body: text,
}, { error: 'The draft fields must contain text.' })

export const postContentSchema = postFieldsSchema.extend({
  title: text.refine(title => title.trim().length > 0, { error: 'Enter a title.' }),
})

export type PostContent = z.infer<typeof postContentSchema>

export const postContentFields = postContentSchema.keyof().options

export function samePostContent(left: PostContent, right: PostContent) {
  return postContentFields.every(field => left[field] === right[field])
}

export const postIdSchema = z.uuid({ error: 'The post ID must be a UUID.' })
export const revisionIdSchema = z.number().int().positive().safe()

export const revisionSources = ['create', 'save', 'publish', 'import', 'restore', 'migration'] as const
export const revisionSourceSchema = z.enum(revisionSources)

export type PostRevision = PostContent & {
  id: number
  postId: string
  createdAt: string
  source: z.infer<typeof revisionSourceSchema>
  restoredFromRevisionId: number | null
}

export type PostRevisionSummary = Omit<PostRevision, 'body' | 'description'>

export type PostRevisionHistory = {
  draft: DraftPost
  published: PublishedPost | null
  selectedRevision: PostRevision
  revisions: PostRevisionSummary[]
  page: number
  pageCount: number
  revisionCount: number
}

export const draftPostSchema = postContentSchema.extend({
  id: z.string().min(1),
  revisionId: revisionIdSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

export type DraftPost = z.infer<typeof draftPostSchema>

export const publishedPostSchema = postContentSchema.extend({
  id: postIdSchema,
  revisionId: revisionIdSchema,
  publicationId: revisionIdSchema,
  createdAt: z.iso.datetime(),
  publishedAt: z.iso.datetime(),
}).strict()

export type PublishedPost = z.infer<typeof publishedPostSchema>

export type PostPublication = {
  id: number
  postId: string
  revisionId: number
  publishedAt: string
}

export type PostMutationResult<T> =
  | { status: 'success'; value: T }
  | { status: 'missing' }
  | { status: 'conflict' }

export type RestoreFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; signInRequired?: true }

export const restoreRevisionSchema = z.object({
  revisionId: revisionIdSchema,
  expectedRevisionId: revisionIdSchema,
}).strict()

const revisionQueryNumber = z.string().regex(/^[1-9][0-9]*$/).transform(Number).pipe(revisionIdSchema)

export const revisionHistoryQuerySchema = z.object({
  page: revisionQueryNumber.default(1),
  revisionId: revisionQueryNumber.optional(),
})

export type RevisionHistoryQuery = z.infer<typeof revisionHistoryQuerySchema>

export const REVISION_PAGE_SIZE = 20

export type PublishedPostSummary = Pick<
  PublishedPost,
  'id' | 'title' | 'description' | 'publishedAt'
>

export const postStatusSchema = z.enum(['draft', 'published', 'modified'])

export type PostSummary = Pick<
  DraftPost,
  'id' | 'title' | 'description' | 'updatedAt'
> & {
  status: z.infer<typeof postStatusSchema>
}

export const identifiedPostContentSchema = postContentSchema.extend({ id: z.string().min(1) })
export type ImportPostInput = z.infer<typeof identifiedPostContentSchema>

export type ImportDraftInput = PostContent & {
  id?: string
}

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
