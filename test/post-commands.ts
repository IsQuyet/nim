import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { DraftPost, PostContent, PublishedPost } from '../modules/posts/model'
import type { WritingCommand, WritingStore } from '../lib/writing'

function write(writer: WritingStore, command: WritingCommand) {
  const result = writer.write(command)
  assert.equal(result.status, 'success')
  return result.value
}

export function createTestDraft(writer: WritingStore, content: PostContent, postId = randomUUID()): DraftPost {
  return write(writer, { postId, operationId: randomUUID(), expectedRevisionId: null, intent: 'save', content }).draft
}

export function saveTestDraft(writer: WritingStore, draft: DraftPost, content: PostContent): DraftPost {
  return write(writer, {
    postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'save',
    content: { title: content.title, description: content.description, body: content.body },
  }).draft
}

export function publishTestDraft(writer: WritingStore, draft: DraftPost, content: PostContent = draft): PublishedPost {
  const result = write(writer, {
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
