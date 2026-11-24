import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { DraftPost, PostContent, PublishedPost } from '../modules/posts/model'
import type { WritingCommand, WritingStore } from '../modules/posts/writing'

async function write(writer: WritingStore, command: WritingCommand) {
  const result = await writer.write(command)
  assert.equal(result.status, 'success')
  return result.value
}

export async function createTestDraft(writer: WritingStore, content: PostContent, postId = randomUUID()): Promise<DraftPost> {
  return (await write(writer, { postId, operationId: randomUUID(), expectedRevisionId: null, intent: 'save', content })).draft
}

export async function saveTestDraft(writer: WritingStore, draft: DraftPost, content: PostContent): Promise<DraftPost> {
  return (await write(writer, {
    postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'save',
    content: { title: content.title, description: content.description, body: content.body },
  })).draft
}

export async function publishTestDraft(
  writer: WritingStore,
  draft: DraftPost,
  content: PostContent = draft,
): Promise<PublishedPost> {
  const result = await write(writer, {
    postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
    content: { title: content.title, description: content.description, body: content.body },
  })
  assert.ok(result.publication)
  return {
    id: result.draft.id,
    revisionId: result.draft.revisionId,
    publicationId: result.publication.id,
    createdAt: result.draft.createdAt,
    publishedAt: result.publication.publishedAt,
    title: result.draft.title,
    description: result.draft.description,
    body: result.draft.body,
  }
}
