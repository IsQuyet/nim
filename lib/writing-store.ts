import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './server/database'
import { contentOf, getDraft, insertDraft, InvalidPublicationMediaError, updateDraft, writePublication, type PostDatabase } from './post-storage'
import { postPublications, postRevisions, posts, postWriteReceipts } from './schema'
import {
  operationIdentitySchema,
  writingCommandSchema,
  type OperationIdentity,
  type ReceiptResult,
  type WritingAcknowledgement,
  type WritingCommand,
  type WritingResult,
  type WritingStore,
} from './writing'

function requestHash(command: WritingCommand) {
  return createHash('sha256').update(JSON.stringify({
    postId: command.postId,
    operationId: command.operationId,
    expectedRevisionId: command.expectedRevisionId,
    intent: command.intent,
    content: contentOf(command.content),
  })).digest('hex')
}

function getReceipt(database: PostDatabase, operationId: string) {
  return database.select({
    postId: postWriteReceipts.postId,
    requestHash: postWriteReceipts.requestHash,
    draft: {
      id: posts.id,
      revisionId: postRevisions.id,
      createdAt: posts.createdAt,
      updatedAt: postRevisions.createdAt,
      title: postRevisions.title,
      description: postRevisions.description,
      body: postRevisions.body,
    },
    publication: { id: postPublications.id, publishedAt: postPublications.publishedAt },
  }).from(postWriteReceipts)
    .innerJoin(posts, eq(posts.id, postWriteReceipts.postId))
    .innerJoin(postRevisions, eq(postRevisions.id, postWriteReceipts.revisionId))
    .leftJoin(postPublications, eq(postPublications.id, postWriteReceipts.publicationId))
    .where(eq(postWriteReceipts.operationId, operationId)).get() ?? null
}

export function createWritingStore(database: AppDatabase): WritingStore {
  function write(input: WritingCommand): WritingResult {
    const parsed = writingCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0].message }
    const command = parsed.data
    const hash = requestHash(command)
    try {
      return database.transaction((transaction): WritingResult => {
        const receipt = getReceipt(transaction, command.operationId)
        if (receipt) {
          if (receipt.postId !== command.postId || receipt.requestHash !== hash) {
            return { status: 'invalid', message: 'This operation ID belongs to a different request.' }
          }
          return { status: 'success', value: { draft: receipt.draft, publication: receipt.publication } }
        }

        const current = getDraft(transaction, command.postId)
        if ((current?.revisionId ?? null) !== command.expectedRevisionId) return { status: 'conflict', current }
        if (!current) {
          const identity = transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, command.postId)).get()
          if (identity) return { status: 'conflict', current: null }
        }
        const draft = current
          ? updateDraft(transaction, current, command.content, command.intent)
          : insertDraft(transaction, command.postId, command.content, 'create')
        let publication: WritingAcknowledgement['publication'] = null
        if (command.intent === 'publish') {
          const published = writePublication(transaction, draft)
          publication = { id: published.publicationId, publishedAt: published.publishedAt }
        }
        transaction.insert(postWriteReceipts).values({
          operationId: command.operationId,
          postId: command.postId,
          requestHash: hash,
          revisionId: draft.revisionId,
          publicationId: publication?.id ?? null,
        }).run()
        return { status: 'success', value: { draft, publication } }
      }, { behavior: 'immediate' })
    } catch (error) {
      if (error instanceof InvalidPublicationMediaError) return { status: 'invalid', message: error.message }
      throw error
    }
  }

  function inspect(input: OperationIdentity): ReceiptResult {
    const parsed = operationIdentitySchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0].message }
    const receipt = getReceipt(database, parsed.data.operationId)
    if (!receipt) return { status: 'unconfirmed' }
    if (receipt.postId !== parsed.data.postId) {
      return { status: 'invalid', message: 'This operation ID belongs to a different post.' }
    }
    return { status: 'success', value: { draft: receipt.draft, publication: receipt.publication } }
  }

  return { getDraft: id => getDraft(database, id), write, inspect }
}
