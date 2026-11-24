'use server'

import { postIdSchema } from '../../model'
import { withAdminPostStore } from '../admin'
import { publishedPostReadSchema } from '../../comparison'
import { runAdminAction } from './run'

export async function readPublishedPostAction(input: unknown) {
  return runAdminAction(withAdminPostStore, {
    unauthorizedMessage: 'Sign in to compare with the published version.',
    errorLog: '读取文章发布版本失败。',
    errorMessage: 'Could not load the published version.',
  }, async store => {
    const parsed = postIdSchema.safeParse(input)
    return parsed.success
      ? publishedPostReadSchema.parse({ status: 'success', value: await store.getPublishedPost(parsed.data) })
      : { status: 'error' as const, message: 'Invalid post ID.' }
  })
}
