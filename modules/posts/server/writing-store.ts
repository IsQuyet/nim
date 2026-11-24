import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { contentOf, getDraft, insertDraft, InvalidPublicationMediaError, updateDraft, writePublication, type PostDatabase } from './storage'
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
} from '../writing'

function requestHash(command: WritingCommand) {
  return createHash('sha256').update(JSON.stringify({
    postId: command.postId,
    operationId: command.operationId,
    expectedRevisionId: command.expectedRevisionId,
    intent: command.intent,
    content: contentOf(command.content),
  })).digest('hex')
}

async function getReceipt(database: PostDatabase, operationId: string) {
  const [row] = await database.select({
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
    .where(eq(postWriteReceipts.operationId, operationId)).limit(1)
  return row ?? null
}

export function createWritingStore(database: AppDatabase): WritingStore {
  async function write(input: WritingCommand): Promise<WritingResult> {
    const parsed = writingCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0].message }
    const command = parsed.data
    const hash = requestHash(command)
    try {
      return await database.transaction(async (transaction): Promise<WritingResult> => {
        const receipt = await getReceipt(transaction, command.operationId)
        if (receipt) {
          if (receipt.postId !== command.postId || receipt.requestHash !== hash) {
            return { status: 'invalid', message: 'This operation ID belongs to a different request.' }
          }
          return { status: 'success', value: { draft: receipt.draft, publication: receipt.publication } }
        }

        await transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, command.postId)).for('update')
        const current = await getDraft(transaction, command.postId)
        if ((current?.revisionId ?? null) !== command.expectedRevisionId) return { status: 'conflict', current }
        if (!current) {
          const [identity] = await transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, command.postId)).limit(1)
          if (identity) return { status: 'conflict', current: null }
        }
        const draft = current
          ? await updateDraft(transaction, current, command.content, command.intent)
          : await insertDraft(transaction, command.postId, command.content, 'create')
        let publication: WritingAcknowledgement['publication'] = null
        if (command.intent === 'publish') {
          const published = await writePublication(transaction, draft)
          publication = { id: published.publicationId, publishedAt: published.publishedAt }
        }
        await transaction.insert(postWriteReceipts).values({
          operationId: command.operationId,
          postId: command.postId,
          requestHash: hash,
          revisionId: draft.revisionId,
          publicationId: publication?.id ?? null,
        })
        return { status: 'success', value: { draft, publication } }
      })
    } catch (error) {
      if (error instanceof InvalidPublicationMediaError) return { status: 'invalid', message: error.message }
      throw error
    }
  }

  async function inspect(input: OperationIdentity): Promise<ReceiptResult> {
    const parsed = operationIdentitySchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0].message }
    const receipt = await getReceipt(database, parsed.data.operationId)
    if (!receipt) return { status: 'unconfirmed' }
    if (receipt.postId !== parsed.data.postId) {
      return { status: 'invalid', message: 'This operation ID belongs to a different post.' }
    }
    return { status: 'success', value: { draft: receipt.draft, publication: receipt.publication } }
  }

  return { getDraft: id => getDraft(database, id), write, inspect }
}
