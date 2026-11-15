import { z } from 'zod'
import { postContentSchema, postIdSchema, type DraftFormState, type DraftPost, type PostMutationResult, type PostStore } from './content'
import { parseMarkdownFile, serializeMarkdownFile } from './markdown-file'

export const postFileStageSchema = z.enum(['draft', 'published'])
export type PostFileStage = z.infer<typeof postFileStageSchema>
export type PostFileFormState = Extract<DraftFormState, { status: 'idle' | 'error' }>

type InvalidFile = { status: 'invalid'; message: string }

export function decodeMarkdownBytes(bytes: ArrayBuffer | Uint8Array):
  | { success: true; source: string }
  | { success: false; message: string } {
  try {
    return { success: true, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch {
    return { success: false, message: 'Save the Markdown file with UTF-8 encoding.' }
  }
}

export function importPostMarkdown(
  store: Pick<PostStore, 'importDraft' | 'createDraftOnce'>,
  source: string,
  newPostId: string,
): PostMutationResult<DraftPost> | InvalidFile {
  const parsed = parseMarkdownFile(source)
  if (!parsed.success) return { status: 'invalid', message: parsed.message }
  if (parsed.data.id !== undefined) {
    return { status: 'success', value: store.importDraft(parsed.data) }
  }
  const identity = postIdSchema.safeParse(newPostId)
  if (!identity.success) return { status: 'invalid', message: identity.error.issues[0].message }
  return store.createDraftOnce(identity.data, parsed.data, 'import')
}

export function exportPostMarkdown(
  store: Pick<PostStore, 'getWorkingCopy' | 'getPublishedPost'>,
  id: string,
  stage: PostFileStage = 'draft',
): { status: 'success'; source: string; filename: string } | { status: 'missing' } | InvalidFile {
  const post = stage === 'draft' ? store.getWorkingCopy(id) : store.getPublishedPost(id)
  if (!post) return { status: 'missing' }
  const identity = postIdSchema.safeParse(post.id)
  const content = postContentSchema.safeParse(post)
  if (!identity.success || !content.success) {
    return { status: 'invalid', message: 'This post does not satisfy the Markdown file format. Review its ID and content.' }
  }
  return {
    status: 'success',
    source: serializeMarkdownFile({ ...content.data, id: identity.data }),
    filename: `${identity.data}.md`,
  }
}
