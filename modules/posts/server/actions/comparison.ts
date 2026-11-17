'use server'

import { unstable_rethrow } from 'next/navigation'
import { postIdSchema } from '../../model'
import { signInRequired } from '@/modules/auth/failure'
import { withAdminPostStore } from '../admin'
import { publishedPostReadSchema } from '../../comparison'

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
      : signInRequired('Sign in to compare with the published version.'))
  } catch (error) {
    unstable_rethrow(error)
    console.error('读取文章发布版本失败。', error)
    return { status: 'error', message: 'Could not load the published version.' } as const
  }
}
