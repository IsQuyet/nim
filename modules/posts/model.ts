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
export const revisionIdSchema = z.number().int().positive().max(2_147_483_647)

export const revisionSources = ['create', 'save', 'publish', 'import', 'restore', 'migration'] as const
export const revisionSourceSchema = z.enum(revisionSources)

export type PostRevision = PostContent & {
  id: number
  postId: string
  createdAt: string
  source: z.infer<typeof revisionSourceSchema>
  restoredFromRevisionId: number | null
}

export const draftPostSchema = postContentSchema.extend({
  id: postIdSchema,
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

export const identifiedPostContentSchema = postContentSchema.extend({ id: postIdSchema })
export type ImportPostInput = z.infer<typeof identifiedPostContentSchema>

export type ImportDraftInput = PostContent & {
  id?: string
}
