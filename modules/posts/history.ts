import { z } from 'zod'
import { revisionIdSchema, type DraftPost, type PostRevision, type PublishedPost } from './model'

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
