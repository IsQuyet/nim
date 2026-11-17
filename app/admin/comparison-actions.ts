'use server'

import { unstable_rethrow } from 'next/navigation'
import { postIdSchema } from '@/modules/posts/model'
import { withAdminPostStore } from '@/modules/posts/server/admin'
import { publishedPostReadSchema } from '@/modules/posts/comparison'

export async function readPublishedPostAction(input: unknown) {
  try {
    const result = await withAdminPostStore(store => {
      const parsed = postIdSchema.safeParse(input)
      return parsed.success
        ? { status: 'success' as const, value: store.getPublishedPost(parsed.data) }
        : { status: 'error' as const, message: 'Invalid post ID.' }
    })
    return publishedPostReadSchema.parse(result.authorized
      ? result.value
      : { status: 'error', message: 'Sign in to compare with the published version.', signInRequired: true })
  } catch (error) {
    unstable_rethrow(error)
    console.error('读取文章发布版本失败。', error)
    return { status: 'error', message: 'Could not load the published version.' } as const
  }
}
