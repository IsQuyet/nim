'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { signInRequired } from '@/modules/auth/failure'
import { withAdminPostStore } from '@/modules/posts/server/admin'
import { restoreRevisionSchema, type RestoreFormState } from '@/modules/posts/history'

export async function restoreRevisionAction(
  id: string,
  input: unknown,
  _state: RestoreFormState,
): Promise<RestoreFormState> {
  void _state
  try {
    const result = await withAdminPostStore(store => {
      const parsed = restoreRevisionSchema.safeParse(input)
      if (!parsed.success) return { status: 'error' as const, message: parsed.error.issues[0].message }
      const { revisionId, expectedRevisionId } = parsed.data
      return store.restoreRevision(id, revisionId, expectedRevisionId)
    })
    if (!result.authorized) return signInRequired('Sign in to restore this revision.')
    if (result.value.status === 'error') return result.value
    if (result.value.status === 'missing') return { status: 'error', message: 'This draft or revision does not exist.' }
    if (result.value.status === 'conflict') return { status: 'error', message: 'This draft changed while you were viewing history. Reload the history page before restoring.' }
  } catch (error) {
    unstable_rethrow(error)
    console.error('恢复草稿修订失败。', error)
    return { status: 'error', message: 'Could not restore the revision. Please try again.' }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  revalidatePath(`/admin/posts/${id}/history`)
  redirect(`/admin/posts/${id}`)
}
