'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import type { ZodType } from 'zod'
import { withAdminPostStore } from '@/lib/admin-posts'
import {
  draftEditorInputSchema,
  draftWriteSchema,
  type DraftFormState,
  type DraftPost,
  type PostStore,
} from '@/lib/content'

type DraftErrorState = Extract<DraftFormState, { status: 'error' }>

type DraftWriteResult =
  | { status: 'saved'; draft: DraftPost }
  | DraftErrorState

const createDraftInputSchema = draftEditorInputSchema.pick({ content: true })

async function writeDraft<Input>(
  input: unknown,
  schema: ZodType<Input>,
  operation: (store: PostStore, input: Input) => DraftWriteResult,
): Promise<DraftWriteResult> {
  try {
    const result = await withAdminPostStore((store): DraftWriteResult => {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        return { status: 'error', message: parsed.error.issues[0].message }
      }

      return operation(store, parsed.data)
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
  const result = await writeDraft(input, createDraftInputSchema, (store, { content }) => ({
    status: 'saved',
    draft: store.createDraft(content),
  }))
  if (result.status === 'error') return result

  revalidatePath('/admin')
  redirect(`/admin/posts/${result.draft.id}`)
}

export async function saveDraftAction(
  id: string,
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, draftWriteSchema, (store, { content, expectedRevisionId }) => {
    const saved = store.saveDraft(id, content, expectedRevisionId)
    if (saved.status === 'missing') {
      return { status: 'error', message: 'This draft does not exist.' }
    }
    if (saved.status === 'conflict') {
      return {
        status: 'error',
        message: 'This draft changed since you opened it. Your input is preserved. Review the latest draft before saving again.',
      }
    }
    return { status: 'saved', draft: saved.value }
  })
  if (result.status === 'error') return result

  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  const { title, description, body, revisionId } = result.draft
  return { status: 'saved', content: { title, description, body }, revisionId }
}
