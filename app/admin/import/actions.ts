'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { withAdminPostStore } from '@/modules/posts/server/admin'
import { postIdSchema, type DraftPost } from '@/modules/posts/model'
import { MAX_MARKDOWN_UPLOAD_BYTES } from '@/lib/post-file-policy'
import { decodeMarkdownBytes, importPostMarkdown, type PostFileFormState } from '@/lib/post-files'

type ImportResult =
  | { status: 'success'; value: DraftPost }
  | Extract<PostFileFormState, { status: 'error' }>

export async function importMarkdownAction(
  _state: PostFileFormState,
  input: unknown,
): Promise<PostFileFormState> {
  let result: ImportResult
  try {
    const authorized = await withAdminPostStore(async (store): Promise<ImportResult> => {
      if (!(input instanceof FormData)) {
        return { status: 'error', message: 'Choose exactly one Markdown file.' }
      }
      const files = input.getAll('file')
      const [file] = files
      if (files.length !== 1 || !(file instanceof File) || !file.name) {
        return { status: 'error', message: 'Choose exactly one Markdown file.' }
      }
      const identities = input.getAll('newPostId')
      const identity = postIdSchema.safeParse(identities.length === 1 ? identities[0] : identities)
      if (!identity.success) {
        return { status: 'error', message: identity.error.issues[0].message }
      }
      if (file.size > MAX_MARKDOWN_UPLOAD_BYTES) {
        return {
          status: 'error',
          message: `The Markdown file exceeds the ${MAX_MARKDOWN_UPLOAD_BYTES / 1024 / 1024} MiB limit.`,
        }
      }
      const decoded = decodeMarkdownBytes(await file.arrayBuffer())
      if (!decoded.success) return { status: 'error', message: decoded.message }
      const imported = importPostMarkdown(store, decoded.source, identity.data)
      if (imported.status === 'invalid') return { status: 'error', message: imported.message }
      if (imported.status === 'conflict') {
        return {
          status: 'error',
          message: 'A draft already exists for this import attempt with different content. Your file selection is preserved. Check the saved draft or start a new import.',
          reviewPostId: identity.data,
        }
      }
      if (imported.status === 'missing') {
        return { status: 'error', message: 'This draft could not be found. Check the file ID before retrying.' }
      }
      return imported
    })
    if (!authorized.authorized) {
      return { status: 'error', message: 'Sign in to import Markdown.', signInRequired: true }
    }
    result = authorized.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('导入 Markdown 文件失败。', error)
    return { status: 'error', message: 'Could not import the Markdown file. Please try again.' }
  }
  if (result.status === 'error') return result

  const id = result.value.id
  revalidatePath('/admin')
  revalidatePath(`/admin/posts/${id}`)
  revalidatePath(`/admin/posts/${id}/history`)
  revalidatePath('/admin/import')
  redirect(`/admin/posts/${id}`)
}
