import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from './database'
import { postIdSchema } from './content'
import { contentOf, getDraft, getWorkingCopy, insertRevision, updateDraft, writePublication, writeWorkingCopy } from './post-storage'
import { postDrafts, posts, postWriteReceipts } from './schema'
import { writingCommandSchema, type WritingAcknowledgement, type WritingCommand, type WritingResult, type WritingStore } from './writing'

function requestHash(command: WritingCommand) {
  return createHash('sha256').update(JSON.stringify({
    postId: command.postId,
    operationId: command.operationId,
    expectedVersion: command.expectedVersion,
    intent: command.intent,
    content: contentOf(command.content),
  })).digest('hex')
}

export function createWritingStore(database: AppDatabase): WritingStore {
  function write(input: WritingCommand): WritingResult {
    const parsed = writingCommandSchema.safeParse(input)
    if (!parsed.success) return { status: 'invalid', message: parsed.error.issues[0].message }
    const command = parsed.data
    const hash = requestHash(command)
    return database.transaction((transaction): WritingResult => {
      const current = getWorkingCopy(transaction, command.postId)
      const receipt = transaction.select().from(postWriteReceipts)
        .where(eq(postWriteReceipts.operationId, command.operationId)).get()
      if (receipt) {
        if (receipt.postId !== command.postId || receipt.requestHash !== hash) {
          return { status: 'invalid', message: 'This operation ID belongs to a different request.' }
        }
        if (!current) throw new Error('已确认的工作稿缺少文档身份。')
        // 回执只保留请求摘要和确认元数据，正文由经摘要核对的原请求重建。
        return {
          status: 'success',
          value: {
            workingCopy: {
              id: receipt.postId,
              ...contentOf(command.content),
              version: receipt.version,
              checkpointRevisionId: receipt.revisionId,
              createdAt: current.createdAt,
              updatedAt: receipt.updatedAt,
            },
            publication: receipt.publicationId !== null && receipt.publishedAt !== null
              ? { id: receipt.publicationId, publishedAt: receipt.publishedAt }
              : null,
          },
        }
      }
      if ((current?.version ?? null) !== command.expectedVersion) return { status: 'conflict', current }
      if (!current) {
        const identity = transaction.select({ id: posts.id }).from(posts).where(eq(posts.id, command.postId)).get()
        if (identity) return { status: 'conflict', current: null }
        if (!postIdSchema.safeParse(command.postId).success) {
          return { status: 'invalid', message: 'A new post ID must be a UUID.' }
        }
        transaction.insert(posts).values({ id: command.postId, createdAt: new Date().toISOString() }).run()
      }

      let publication: WritingAcknowledgement['publication'] = null
      if (command.intent === 'autosave') {
        writeWorkingCopy(transaction, command.postId, command.content)
      } else {
        const previous = getDraft(transaction, command.postId)
        let draft
        if (previous) {
          draft = updateDraft(transaction, previous, command.content, command.intent === 'save' ? 'save' : 'publish')
        } else {
          const revision = insertRevision(transaction, command.postId, command.content, 'create')
          transaction.insert(postDrafts).values({ postId: command.postId, revisionId: revision.id }).run()
          const working = writeWorkingCopy(transaction, command.postId, command.content, true, revision.createdAt)
          draft = { id: working.id, ...contentOf(working), revisionId: revision.id, createdAt: working.createdAt, updatedAt: revision.createdAt }
        }
        if (command.intent === 'publish') {
          const published = writePublication(transaction, draft)
          publication = { id: published.publicationId, publishedAt: published.publishedAt }
        }
      }
      const workingCopy = getWorkingCopy(transaction, command.postId)
      if (!workingCopy) throw new Error('无法确认工作稿写入结果。')
      transaction.insert(postWriteReceipts).values({
        operationId: command.operationId,
        postId: command.postId,
        requestHash: hash,
        version: workingCopy.version,
        revisionId: workingCopy.checkpointRevisionId,
        updatedAt: workingCopy.updatedAt,
        publicationId: publication?.id ?? null,
        publishedAt: publication?.publishedAt ?? null,
      }).run()
      return { status: 'success', value: { workingCopy, publication } }
    }, { behavior: 'immediate' })
  }

  return { getWorkingCopy: id => getWorkingCopy(database, id), write }
}
