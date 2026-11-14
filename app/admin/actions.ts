'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { AdminPostStoreError, withAdminPostStore } from '@/lib/admin-posts'
import type { createPostStore, DraftPost, PostContent } from '@/lib/posts'

export type DraftFormState =
  | { status: 'idle' }
  | { status: 'saved'; content: PostContent }
  | { status: 'error'; message: string }

type DraftWriteResult =
  | { ok: true; draft: DraftPost }
  | { ok: false; message: string }

type DraftOperation = (
  store: ReturnType<typeof createPostStore>,
  content: PostContent,
) => DraftPost | null

async function writeDraft(
  input: unknown,
  operation: DraftOperation,
): Promise<DraftWriteResult> {
  try {
    return await withAdminPostStore((store): DraftWriteResult => {
      if (!input || typeof input !== 'object') {
        return { ok: false, message: 'The draft fields must contain text.' }
      }
      const { title, description, body } = input as Record<string, unknown>
      if (
        typeof title !== 'string' ||
        typeof description !== 'string' ||
        typeof body !== 'string'
      ) {
        return { ok: false, message: 'The draft fields must contain text.' }
      }
      if (!title.trim()) return { ok: false, message: 'Enter a title.' }

      const draft = operation(store, { title, description, body })
      if (!draft) return { ok: false, message: 'This draft does not exist.' }
      return { ok: true, draft }
    })
  } catch (error) {
    if (!(error instanceof AdminPostStoreError)) throw error
    console.error('保存草稿失败。', error)
    return { ok: false, message: 'Could not save the draft. Please try again.' }
  }
}

export async function createDraftAction(
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, (store, content) =>
    store.createDraft(content),
  )
  if (!result.ok) return { status: 'error', message: result.message }

  revalidatePath('/admin')
  redirect(`/admin/posts/${result.draft.id}`)
}

export async function saveDraftAction(
  id: string,
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, (store, content) => store.saveDraft(id, content))
  if (!result.ok) return { status: 'error', message: result.message }

  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  const { title, description, body } = result.draft
  return { status: 'saved', content: { title, description, body } }
}
