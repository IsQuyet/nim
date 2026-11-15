import { z } from 'zod'
import { draftPostSchema, postContentSchema, postFieldsSchema, postIdSchema, revisionIdSchema } from './content'

export const operationIdentitySchema = z.object({
  postId: postIdSchema,
  operationId: z.uuid(),
}).strict()

export type OperationIdentity = z.infer<typeof operationIdentitySchema>

export const writingCommandSchema = operationIdentitySchema.extend({
  expectedRevisionId: revisionIdSchema.nullable(),
  intent: z.enum(['save', 'publish']),
  content: postContentSchema.strict(),
}).strict()

export type WritingCommand = z.infer<typeof writingCommandSchema>
export type WritingIntent = WritingCommand['intent']

export const writingAcknowledgementSchema = z.object({
  draft: draftPostSchema,
  publication: z.object({ id: revisionIdSchema, publishedAt: z.iso.datetime() }).strict().nullable(),
}).strict()

export type WritingAcknowledgement = z.infer<typeof writingAcknowledgementSchema>

const writingSuccessSchema = z.object({ status: z.literal('success'), value: writingAcknowledgementSchema }).strict()
const writingConflictSchema = z.object({ status: z.literal('conflict'), current: draftPostSchema.nullable() }).strict()
const writingInvalidSchema = z.object({ status: z.literal('invalid'), message: z.string() }).strict()
const writingErrorSchema = z.object({ status: z.literal('error'), message: z.string(), signInRequired: z.literal(true).optional() }).strict()
const writingUnconfirmedSchema = z.object({ status: z.literal('unconfirmed') }).strict()

export const writingResultSchema = z.discriminatedUnion('status', [writingSuccessSchema, writingConflictSchema, writingInvalidSchema])
export type WritingResult = z.infer<typeof writingResultSchema>

export const writingFeedbackSchema = z.discriminatedUnion('status', [writingSuccessSchema, writingConflictSchema, writingInvalidSchema, writingErrorSchema])
export type WritingFeedback = z.infer<typeof writingFeedbackSchema>

export const receiptResultSchema = z.discriminatedUnion('status', [writingSuccessSchema, writingUnconfirmedSchema, writingInvalidSchema])
export type ReceiptResult = z.infer<typeof receiptResultSchema>
export const receiptFeedbackSchema = z.discriminatedUnion('status', [writingSuccessSchema, writingUnconfirmedSchema, writingInvalidSchema, writingErrorSchema])
export type ReceiptFeedback = z.infer<typeof receiptFeedbackSchema>

export const draftReadResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), value: draftPostSchema.nullable() }).strict(),
  writingErrorSchema,
])

export type WritingStore = {
  getDraft(id: string): z.infer<typeof draftPostSchema> | null
  write(command: WritingCommand): WritingResult
  inspect(operation: OperationIdentity): ReceiptResult
}

export type WritingTransport = {
  read(postId: string): Promise<z.infer<typeof draftReadResultSchema>>
  write(command: WritingCommand): Promise<WritingFeedback>
  inspect(operation: OperationIdentity): Promise<ReceiptFeedback>
}

export const recoveryCopySchema = z.object({
  format: z.literal('nim-recovery/v2'),
  sessionId: z.uuid(),
  postId: postIdSchema,
  content: postFieldsSchema.strict(),
  remote: draftPostSchema.nullable(),
  pending: writingCommandSchema.nullable(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((copy, context) => {
  if (copy.remote && copy.remote.id !== copy.postId) {
    context.addIssue({ code: 'custom', message: '恢复副本的远端身份不一致。' })
  }
  if (copy.pending && (copy.pending.postId !== copy.postId || copy.pending.expectedRevisionId !== (copy.remote?.revisionId ?? null))) {
    context.addIssue({ code: 'custom', message: '恢复副本的请求身份或编辑基线不一致。' })
  }
})

export type RecoveryCopy = z.infer<typeof recoveryCopySchema>

export type RecoveryStore = {
  list(postId?: string): Promise<RecoveryCopy[]>
  put(copy: RecoveryCopy): Promise<void>
  remove(sessionId: string): Promise<void>
  close(): void
}
