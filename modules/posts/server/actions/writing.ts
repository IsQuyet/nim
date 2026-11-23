'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { signInRequired } from '@/modules/auth/failure'
import { withAdminWritingStore } from '../admin'
import { operationIdentitySchema, writingCommandSchema, type ReceiptFeedback, type WritingFeedback, type WritingTransport } from '../../writing'
import { routes } from '@/lib/routes'

export async function writeDraftAction(input: unknown): Promise<WritingFeedback> {
  try {
    const result = await withAdminWritingStore(store => {
      const parsed = writingCommandSchema.safeParse(input)
      return parsed.success
        ? store.write(parsed.data)
        : { status: 'invalid' as const, message: parsed.error.issues[0].message }
    })
    if (!result.authorized) return signInRequired('Sign in to save or publish this draft.')
    if (result.value.status === 'success') {
      const command = writingCommandSchema.parse(input)
      revalidatePath(routes.admin.home)
      revalidatePath(routes.admin.post(command.postId))
      revalidatePath(routes.admin.postHistory(command.postId))
      if (command.intent === 'publish') {
        revalidatePath('/')
        revalidatePath(routes.post(command.postId))
        revalidatePath('/sitemap.xml')
      }
    }
    return result.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('确认草稿写入失败。', error)
    return { status: 'error', message: 'Could not confirm the operation. Your input is preserved. Check its receipt before retrying.' }
  }
}

export async function readDraftAction(postId: unknown): ReturnType<WritingTransport['read']> {
  try {
    const result = await withAdminWritingStore(store => {
      const parsed = z.string().min(1).safeParse(postId)
      if (!parsed.success) return { status: 'error' as const, message: 'Invalid post ID.' }
      return { status: 'success' as const, value: store.getDraft(parsed.data) }
    })
    return result.authorized ? result.value : signInRequired('Sign in to check this draft.')
  } catch (error) {
    unstable_rethrow(error)
    console.error('读取草稿失败。', error)
    return { status: 'error', message: 'Could not check the server draft. Your input is preserved.' }
  }
}

export async function inspectDraftOperationAction(input: unknown): Promise<ReceiptFeedback> {
  try {
    const result = await withAdminWritingStore(store => {
      const parsed = operationIdentitySchema.safeParse(input)
      return parsed.success
        ? store.inspect(parsed.data)
        : { status: 'invalid' as const, message: parsed.error.issues[0].message }
    })
    return result.authorized ? result.value : signInRequired('Sign in to check this operation.')
  } catch (error) {
    unstable_rethrow(error)
    console.error('读取草稿操作回执失败。', error)
    return { status: 'error', message: 'Could not check the operation receipt. Your input is preserved.' }
  }
}
