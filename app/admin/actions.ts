'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { withAdminPostStore } from '@/lib/admin-posts'
import type { createPostStore, DraftPost, PostContent } from '@/lib/posts'

type DraftErrorState = {
  status: 'error'
  message: string
  signInRequired?: true
}

export type DraftFormState =
  | { status: 'idle' }
  | { status: 'saved'; content: PostContent }
  | DraftErrorState

type DraftWriteResult =
  | { status: 'saved'; draft: DraftPost }
  | DraftErrorState

type DraftOperation = (
  store: ReturnType<typeof createPostStore>,
  content: PostContent,
) => DraftPost | null

async function writeDraft(
  input: unknown,
  operation: DraftOperation,
): Promise<DraftWriteResult> {
  try {
    const result = await withAdminPostStore((store): DraftWriteResult => {
      if (!input || typeof input !== 'object') {
        return { status: 'error', message: 'The draft fields must contain text.' }
      }
      const { title, description, body } = input as Record<string, unknown>
      if (
        typeof title !== 'string' ||
        typeof description !== 'string' ||
        typeof body !== 'string'
      ) {
        return { status: 'error', message: 'The draft fields must contain text.' }
      }
      if (!title.trim()) return { status: 'error', message: 'Enter a title.' }

      const draft = operation(store, { title, description, body })
      if (!draft) return { status: 'error', message: 'This draft does not exist.' }
      return { status: 'saved', draft }
    })
    if (!result.authorized) {
      return { status: 'error', message: 'Sign in to save this draft.', signInRequired: true }
    }
    return result.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('保存草稿失败。', error)
    return { status: 'error', message: 'Could not save the draft. Please try again.' }
  }
}

export async function createDraftAction(
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, (store, content) => store.createDraft(content))
  if (result.status === 'error') return result

  revalidatePath('/admin')
  redirect(`/admin/posts/${result.draft.id}`)
}

export async function saveDraftAction(
  id: string,
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, (store, content) => store.saveDraft(id, content))
  if (result.status === 'error') return result

  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  const { title, description, body } = result.draft
  return { status: 'saved', content: { title, description, body } }
}
