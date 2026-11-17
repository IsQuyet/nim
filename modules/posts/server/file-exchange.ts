import { postContentSchema, postIdSchema, type DraftPost, type PostMutationResult } from '../model'
import type { PostFileStage } from '../files'
import type { PostStore } from './store'
import { parseMarkdownFile, serializeMarkdownFile } from './file-format'

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
  store: Pick<PostStore, 'importDraft' | 'createImportedDraftOnce'>,
  source: string,
  newPostId: string,
): PostMutationResult<DraftPost> | InvalidFile {
  const parsed = parseMarkdownFile(source)
  if (!parsed.success) return { status: 'invalid', message: parsed.message }
  if (parsed.data.id !== undefined) {
    return { status: 'success', value: store.importDraft({ ...parsed.data, id: parsed.data.id }) }
  }
  const identity = postIdSchema.safeParse(newPostId)
  if (!identity.success) return { status: 'invalid', message: identity.error.issues[0].message }
  return store.createImportedDraftOnce(identity.data, parsed.data)
}

export function exportPostMarkdown(
  store: Pick<PostStore, 'getDraft' | 'getPublishedPost'>,
  id: string,
  stage: PostFileStage = 'draft',
): { status: 'success'; source: string; filename: string } | { status: 'missing' } | InvalidFile {
  const post = stage === 'draft' ? store.getDraft(id) : store.getPublishedPost(id)
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
