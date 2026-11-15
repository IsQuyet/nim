'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import type { ZodType } from 'zod'
import { withAdminPostStore } from '@/lib/admin-posts'
import {
  draftEditorInputSchema,
  draftWriteSchema,
  restoreRevisionSchema,
  type DraftFormState,
  type DraftPost,
  type PostMutationResult,
  type PostStore,
  type RestoreFormState,
} from '@/lib/content'

type DraftErrorState = Extract<DraftFormState, { status: 'error' }>
type WrittenContent = Pick<DraftPost, 'id' | 'revisionId' | 'title' | 'description' | 'body'>
type DraftWriteResult =
  | { status: 'success'; value: WrittenContent }
  | DraftErrorState

type WriteFeedback = {
  signIn: string
  missing: string
  conflict: string
  failure: string
  log: string
}

const saveFeedback: WriteFeedback = {
  signIn: 'Sign in to save this draft.',
  missing: 'This draft does not exist.',
  conflict: 'This draft changed since you opened it. Your input is preserved. Review the latest draft before saving again.',
  failure: 'Could not save the draft. Please try again.',
  log: '保存草稿失败。',
}

const publishFeedback: WriteFeedback = {
  signIn: 'Sign in to publish this post.',
  missing: 'This draft does not exist.',
  conflict: 'This draft changed since you opened it. Your input is preserved. Review the latest draft before publishing again.',
  failure: 'Could not publish the post. Please try again.',
  log: '发布文章失败。',
}

const restoreFeedback: WriteFeedback = {
  signIn: 'Sign in to restore this revision.',
  missing: 'This draft or revision does not exist.',
  conflict: 'This draft changed while you were viewing history. Reload the history page before restoring.',
  failure: 'Could not restore the revision. Please try again.',
  log: '恢复草稿修订失败。',
}

const createDraftInputSchema = draftEditorInputSchema.pick({ content: true, creationId: true }).required({ creationId: true })

async function writeDraft<Input>(
  input: unknown,
  schema: ZodType<Input>,
  operation: (store: PostStore, input: Input) => PostMutationResult<WrittenContent> | DraftErrorState,
  feedback: WriteFeedback,
): Promise<DraftWriteResult> {
  try {
    const result = await withAdminPostStore((store): DraftWriteResult => {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        return { status: 'error', message: parsed.error.issues[0].message }
      }

      const written = operation(store, parsed.data)
      if (written.status === 'error') return written
      if (written.status === 'missing') return { status: 'error', message: feedback.missing }
      if (written.status === 'conflict') return { status: 'error', message: feedback.conflict }
      return written
    })
    if (!result.authorized) {
      return { status: 'error', message: feedback.signIn, signInRequired: true }
    }
    return result.value
  } catch (error) {
    unstable_rethrow(error)
    console.error(feedback.log, error)
    return { status: 'error', message: feedback.failure }
  }
}

function revalidateDraftPages(id: string) {
  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  revalidatePath(`/admin/posts/${id}/history`)
}

function draftFormResult(
  status: 'saved' | 'published',
  { title, description, body, revisionId }: WrittenContent,
): DraftFormState {
  return { status, content: { title, description, body }, revisionId }
}

export async function createDraftAction(
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, createDraftInputSchema, (store, { content, creationId }) => {
    const created = store.createDraftOnce(creationId, content)
    if (created.status === 'conflict') {
      return {
        status: 'error',
        message: 'A draft already exists for this request. Your input is preserved. Review the saved draft before continuing.',
        reviewPostId: creationId,
      }
    }
    return created
  }, saveFeedback)
  if (result.status === 'error') return result

  revalidatePath('/admin')
  revalidatePath('/admin/posts/new')
  redirect(`/admin/posts/${result.value.id}`)
}

export async function saveDraftAction(
  id: string,
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, draftWriteSchema, (store, { content, expectedRevisionId }) =>
    store.saveDraft(id, content, expectedRevisionId), saveFeedback)
  if (result.status === 'error') return result

  revalidateDraftPages(id)
  return draftFormResult('saved', result.value)
}

export async function publishDraftAction(
  id: string,
  _state: DraftFormState,
  input: unknown,
): Promise<DraftFormState> {
  const result = await writeDraft(input, draftWriteSchema, (store, { content, expectedRevisionId }) =>
    store.publishDraft(id, content, expectedRevisionId), publishFeedback)
  if (result.status === 'error') return result

  revalidateDraftPages(id)
  revalidatePath('/')
  revalidatePath(`/blog/${id}`)
  revalidatePath('/sitemap.xml')
  return draftFormResult('published', result.value)
}

export async function restoreRevisionAction(
  id: string,
  input: unknown,
  _state: RestoreFormState,
): Promise<RestoreFormState> {
  void _state
  const result = await writeDraft(input, restoreRevisionSchema, (store, { revisionId, expectedRevisionId, expectedWorkingVersion }) =>
    store.restoreRevision(id, revisionId, expectedRevisionId, expectedWorkingVersion), restoreFeedback)
  if (result.status === 'error') return result

  revalidateDraftPages(id)
  redirect(`/admin/posts/${id}`)
}
