import { z } from 'zod'
import { postContentSchema, postFieldsSchema, postIdSchema, revisionIdSchema, workingVersionSchema } from './content'

export { workingVersionSchema } from './content'

export const workingCopySchema = postFieldsSchema.extend({
  id: z.string().min(1),
  version: workingVersionSchema,
  checkpointRevisionId: revisionIdSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict()

export type WorkingCopy = z.infer<typeof workingCopySchema>

const operationSchema = z.object({
  postId: z.string().min(1),
  operationId: z.uuid(),
  expectedVersion: workingVersionSchema.nullable(),
})

export const writingCommandSchema = z.discriminatedUnion('intent', [
  operationSchema.extend({ intent: z.literal('autosave'), content: postFieldsSchema.strict() }).strict(),
  operationSchema.extend({ intent: z.literal('save'), content: postContentSchema.strict() }).strict(),
  operationSchema.extend({ intent: z.literal('publish'), content: postContentSchema.strict() }).strict(),
])

export type WritingCommand = z.infer<typeof writingCommandSchema>
export type WritingIntent = WritingCommand['intent']

export const writingAcknowledgementSchema = z.object({
  workingCopy: workingCopySchema,
  publication: z.object({ id: revisionIdSchema, publishedAt: z.iso.datetime() }).nullable(),
})

export type WritingAcknowledgement = z.infer<typeof writingAcknowledgementSchema>
export type WritingResult =
  | { status: 'success'; value: WritingAcknowledgement }
  | { status: 'conflict'; current: WorkingCopy | null }
  | { status: 'invalid'; message: string }

export type WritingStore = {
  getWorkingCopy(id: string): WorkingCopy | null
  write(command: WritingCommand): WritingResult
}

export type WritingFeedback = WritingResult | {
  status: 'error'
  message: string
  signInRequired?: true
}

export type WritingTransport = {
  read(postId: string): Promise<{ status: 'success'; value: WorkingCopy | null } | Extract<WritingFeedback, { status: 'error' }>>
  write(command: WritingCommand): Promise<WritingFeedback>
}

// 每份本机副本属于一次编辑会话，文档身份与远端基线随副本一起恢复。
export const recoveryCopySchema = z.object({
  format: z.literal('nim-recovery/v1'),
  sessionId: z.uuid(),
  postId: z.string().min(1),
  isNew: z.boolean(),
  content: postFieldsSchema.strict(),
  remote: workingCopySchema.nullable(),
  pending: writingCommandSchema.nullable(),
  updatedAt: z.iso.datetime(),
}).strict().superRefine((copy, context) => {
  if (copy.remote && copy.remote.id !== copy.postId) {
    context.addIssue({ code: 'custom', message: '恢复副本的远端身份不一致。' })
  }
  if (copy.pending && copy.pending.postId !== copy.postId) {
    context.addIssue({ code: 'custom', message: '恢复副本的请求身份不一致。' })
  }
  if (copy.isNew && !postIdSchema.safeParse(copy.postId).success) {
    context.addIssue({ code: 'custom', message: '新稿身份必须是 UUID。' })
  }
})

export type RecoveryCopy = z.infer<typeof recoveryCopySchema>

export type RecoveryStore = {
  list(postId?: string): Promise<RecoveryCopy[]>
  put(copy: RecoveryCopy): Promise<void>
  remove(sessionId: string): Promise<void>
  close(): void
}
