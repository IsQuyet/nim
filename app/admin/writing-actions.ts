'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { withAdminWritingStore } from '@/lib/admin-posts'
import { writingCommandSchema, type WritingFeedback, type WritingTransport } from '@/lib/writing'

export async function writeWorkingCopyAction(input: unknown): Promise<WritingFeedback> {
  try {
    const result = await withAdminWritingStore(store => {
      const parsed = writingCommandSchema.safeParse(input)
      return parsed.success
        ? store.write(parsed.data)
        : { status: 'invalid' as const, message: parsed.error.issues[0].message }
    })
    if (!result.authorized) return { status: 'error', message: 'Sign in to sync this draft.', signInRequired: true }
    if (result.value.status === 'success') {
      const command = writingCommandSchema.parse(input)
      revalidatePath('/admin')
      if (command.intent !== 'autosave') {
        revalidatePath(`/admin/posts/${command.postId}`)
        revalidatePath(`/admin/posts/${command.postId}/history`)
      }
      if (command.intent === 'publish') {
        revalidatePath('/')
        revalidatePath(`/blog/${command.postId}`)
        revalidatePath('/sitemap.xml')
      }
    }
    return result.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('确认工作稿写入失败。', error)
    return { status: 'error', message: 'Could not confirm the operation. Your input is preserved. Retry to check the same request.' }
  }
}

export async function readWorkingCopyAction(postId: unknown): ReturnType<WritingTransport['read']> {
  try {
    const result = await withAdminWritingStore(store => {
      const parsed = z.string().min(1).safeParse(postId)
      if (!parsed.success) return { status: 'error' as const, message: 'Invalid post ID.' }
      return { status: 'success' as const, value: store.getWorkingCopy(parsed.data) }
    })
    return result.authorized ? result.value : { status: 'error', message: 'Sign in to check this draft.', signInRequired: true }
  } catch (error) {
    unstable_rethrow(error)
    console.error('读取工作稿失败。', error)
    return { status: 'error', message: 'Could not check the server draft. Your input is preserved.' }
  }
}
