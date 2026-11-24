'use server'

import { revalidatePath } from 'next/cache'
import { postIdSchema } from '../../model'
import { withAdminWritingStore } from '../admin'
import { operationIdentitySchema, writingCommandSchema, type ReceiptFeedback, type WritingFeedback, type WritingTransport } from '../../writing'
import { routes } from '@/lib/routes'
import { runAdminAction } from './run'

export async function writeDraftAction(input: unknown): Promise<WritingFeedback> {
  return runAdminAction(withAdminWritingStore, {
    unauthorizedMessage: 'Sign in to save or publish this draft.',
    errorLog: '确认草稿写入失败。',
    errorMessage: 'Could not confirm the operation. Your input is preserved. Check its receipt before retrying.',
  }, store => {
    const parsed = writingCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid' as const, message: parsed.error.issues[0].message }
    const command = parsed.data
    const written = store.write(command)
    if (written.status === 'success') {
      revalidatePath(routes.admin.home)
      revalidatePath(routes.admin.post(command.postId))
      revalidatePath(routes.admin.postHistory(command.postId))
      if (command.intent === 'publish') {
        revalidatePath(routes.home)
        revalidatePath(routes.blog)
        revalidatePath(routes.post(command.postId))
        revalidatePath('/sitemap.xml')
      }
    }
    return written
  })
}

export async function readDraftAction(postId: unknown): ReturnType<WritingTransport['read']> {
  return runAdminAction(withAdminWritingStore, {
    unauthorizedMessage: 'Sign in to check this draft.',
    errorLog: '读取草稿失败。',
    errorMessage: 'Could not check the server draft. Your input is preserved.',
  }, store => {
    const parsed = postIdSchema.safeParse(postId)
    if (!parsed.success) return { status: 'error' as const, message: 'Invalid post ID.' }
    return { status: 'success' as const, value: store.getDraft(parsed.data) }
  })
}

export async function inspectDraftOperationAction(input: unknown): Promise<ReceiptFeedback> {
  return runAdminAction(withAdminWritingStore, {
    unauthorizedMessage: 'Sign in to check this operation.',
    errorLog: '读取草稿操作回执失败。',
    errorMessage: 'Could not check the operation receipt. Your input is preserved.',
  }, store => {
    const parsed = operationIdentitySchema.safeParse(input)
    return parsed.success
      ? store.inspect(parsed.data)
      : { status: 'invalid' as const, message: parsed.error.issues[0].message }
  })
}
