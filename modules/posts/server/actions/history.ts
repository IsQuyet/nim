'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { withAdminPostStore } from '../admin'
import { postIdSchema } from '../../model'
import { restoreRevisionSchema, type RestoreFormState } from '../../history'
import { routes } from '@/lib/routes'
import { runAdminAction } from './run'

export async function restoreRevisionAction(
  id: string,
  input: unknown,
  _state: RestoreFormState,
): Promise<RestoreFormState> {
  void _state
  const result = await runAdminAction(withAdminPostStore, {
    unauthorizedMessage: 'Sign in to restore this revision.',
    errorLog: '恢复草稿修订失败。',
    errorMessage: 'Could not restore the revision. Please try again.',
  }, store => {
    const target = postIdSchema.safeParse(id)
    if (!target.success) return { status: 'error' as const, message: 'Invalid post ID.' }
    const parsed = restoreRevisionSchema.safeParse(input)
    if (!parsed.success) return { status: 'error' as const, message: parsed.error.issues[0].message }
    const { revisionId, expectedRevisionId } = parsed.data
    const restored = store.restoreRevision(target.data, revisionId, expectedRevisionId)
    if (restored.status === 'missing') return { status: 'error' as const, message: 'This draft or revision does not exist.' }
    if (restored.status === 'conflict') {
      return { status: 'error' as const, message: 'This draft changed while you were viewing history. Reload the history page before restoring.' }
    }
    return restored
  })
  if (result.status === 'error') return result

  revalidatePath(routes.admin.home)
  revalidatePath(routes.admin.post(id))
  revalidatePath(routes.admin.postHistory(id))
  redirect(routes.admin.post(id))
}
