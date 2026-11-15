// @vitest-environment node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from './database'
import { createPostStore } from './posts'
import { createWritingStore } from './writing-store'
import { postWriteReceipts } from './schema'
import { writingCommandSchema, type WorkingCopy, type WritingCommand, type WritingResult, type WritingStore } from './writing'

let directory: string
let database: AppDatabase
let writer: WritingStore
const content = { title: 'Title', description: '', body: '原文\r\n' }

function command(current: WorkingCopy | null, input: Partial<WritingCommand> = {}): WritingCommand {
  return { postId: current?.id ?? randomUUID(), operationId: randomUUID(), expectedVersion: current?.version ?? null, intent: 'autosave', content, ...input }
}

function written(result: WritingResult) {
  assert.equal(result.status, 'success')
  return result.value.workingCopy
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-writing-'))
  await initializeDatabase(join(directory, 'test.sqlite'))
  database = openDatabase(join(directory, 'test.sqlite'))
  writer = createWritingStore(database)
})
afterEach(() => {
  if (database?.$client.open) database.$client.close()
  if (directory) rmSync(directory, { recursive: true })
})

describe('工作稿与明确修订', () => {
  it('未完成标题也能自动保存，新稿跨连接延续但没有历史或公开内容', () => {
    const input = command(null, { content: { title: '', description: ' ', body: '\n未完成\r\n' } })
    const first = written(writer.write(input))
    const second = written(writer.write(command(first, { content: { ...input.content, body: '继续写' } })))
    expect(second.version).not.toBe(first.version)
    const store = createPostStore(database)
    expect(store.listRevisions(first.id)).toEqual([])
    expect(store.getDraft(first.id)).toBeNull()
    expect(store.getPublishedPost(first.id)).toBeNull()
    expect(store.listPosts()).toEqual([expect.objectContaining({ id: first.id, title: '', status: 'draft' })])
    expect(store.listPosts()[0]).not.toHaveProperty('body')
    const other = openDatabase(join(directory, 'test.sqlite'))
    try { expect(createWritingStore(other).getWorkingCopy(first.id)).toEqual(second) }
    finally { other.$client.close() }
  })

  it('自动保存只移动工作稿，手动保存形成明确节点，发布另记事件', () => {
    const first = written(writer.write(command(null)))
    const saved = written(writer.write(command(first, { intent: 'save' })))
    const store = createPostStore(database)
    expect(saved.checkpointRevisionId).not.toBeNull()
    expect(store.listRevisions(first.id)).toHaveLength(1)
    const pending = written(writer.write(command(saved, { content: { ...content, body: '自动工作内容' } })))
    expect(store.getDraft(first.id)).toMatchObject(content)
    expect(store.listRevisions(first.id)).toHaveLength(1)
    const published = writer.write(command(pending, { intent: 'publish', content: { ...content, body: '当前可见内容' } }))
    assert.equal(published.status, 'success')
    expect(published.value.publication).not.toBeNull()
    expect(store.listRevisions(first.id).map(item => item.source)).toEqual(['publish', 'create'])
    expect(store.getPublishedPost(first.id)?.body).toBe('当前可见内容')
    const after = written(writer.write(command(published.value.workingCopy, { content: { ...content, body: '尚未发布' } })))
    expect(store.getPublishedPost(first.id)?.body).toBe('当前可见内容')
    expect(store.listPosts()[0]).toMatchObject({ updatedAt: after.updatedAt, status: 'modified' })
  })

  it('同内容的停笔、保存与发布不制造重复节点或刷新工作稿时间', () => {
    const first = written(writer.write(command(null, { intent: 'publish' })))
    const auto = written(writer.write(command(first)))
    const save = written(writer.write(command(auto, { intent: 'save' })))
    const again = written(writer.write(command(save, { intent: 'publish' })))
    expect({ ...again, version: first.version }).toEqual(first)
    expect(again.version).not.toBe(first.version)
    expect(createPostStore(database).listRevisions(first.id)).toHaveLength(1)
    expect(createPostStore(database).listPublications(first.id)).toHaveLength(1)
  })

  it('标题完成条件只作用于保存与发布，不改写原文', () => {
    const first = written(writer.write(command(null)))
    for (const intent of ['save', 'publish'] as const) {
      expect(writer.write(command(first, { intent, content: { ...content, title: '  ' } })).status).toBe('invalid')
    }
    const saved = written(writer.write(command(first, { intent: 'save', content: { ...content, title: ' Title\n' } })))
    expect(saved.title).toBe(' Title\n')
  })

  it('旧版本即使内容相同也冲突，两条连接不能覆盖彼此', () => {
    const first = written(writer.write(command(null)))
    const next = written(writer.write(command(first, { content: { ...content, body: '其他标签' } })))
    const other = openDatabase(join(directory, 'test.sqlite'))
    try {
      for (const intent of ['autosave', 'save', 'publish'] as const) {
        expect(createWritingStore(other).write(command(first, { intent, content: next }))).toMatchObject({ status: 'invalid' })
        expect(createWritingStore(other).write(command(first, { intent, content: { title: next.title, description: next.description, body: next.body } })))
          .toEqual({ status: 'conflict', current: next })
      }
    } finally { other.$client.close() }
  })

  it('按 ID 导入完整替换工作稿并使旧自动保存基线失效', () => {
    const first = written(writer.write(command(null, { intent: 'save' })))
    const pending = written(writer.write(command(first, { content: { ...content, body: '自动保存' } })))
    const store = createPostStore(database)
    const imported = store.importDraft({ id: first.id, ...content, body: '文件内容' })
    const current = writer.getWorkingCopy(first.id)
    expect(current).toMatchObject({ body: '文件内容', checkpointRevisionId: imported.revisionId })
    expect(current?.version).not.toBe(pending.version)
    expect(writer.write(command(pending))).toEqual({ status: 'conflict', current })
  })

  it('同内容的明确导入和恢复也消耗旧工作版本，不让排队请求越过它们', () => {
    const store = createPostStore(database)
    const saved = store.createDraft(content)
    for (const operation of [
      () => store.importDraft({ id: saved.id, ...content }),
      () => store.restoreRevision(saved.id, saved.revisionId, saved.revisionId),
    ]) {
      const before = writer.getWorkingCopy(saved.id)
      assert.ok(before)
      const queued = command(before, { content: { ...content, body: '排队中的旧请求' } })
      operation()
      const after = writer.getWorkingCopy(saved.id)
      expect(after?.updatedAt).toBe(before.updatedAt)
      expect(after?.version).not.toBe(before.version)
      expect(writer.write(queued)).toEqual({ status: 'conflict', current: after })
      expect(store.listRevisions(saved.id)).toHaveLength(1)
    }
  })

  it('历史恢复以工作稿版本保护自动内容，恢复到上次修订也留下明确恢复节点', () => {
    const store = createPostStore(database)
    const saved = store.createDraft(content)
    const initial = writer.getWorkingCopy(saved.id)
    assert.ok(initial)
    const pending = written(writer.write(command(initial, { content: { ...content, body: '自动保存' } })))
    expect(store.restoreRevision(saved.id, saved.revisionId, saved.revisionId, initial.version)).toEqual({ status: 'conflict' })
    const restored = store.restoreRevision(saved.id, saved.revisionId, saved.revisionId, pending.version)
    assert.equal(restored.status, 'success')
    expect(restored.value.revisionId).not.toBe(saved.revisionId)
    expect(store.listRevisions(saved.id)[0]).toMatchObject({ source: 'restore', restoredFromRevisionId: saved.revisionId })
    expect(writer.getWorkingCopy(saved.id)).toMatchObject(content)
    expect(store.getRevisionHistory(saved.id)?.workingCopy).toEqual(writer.getWorkingCopy(saved.id))
  })

  it('导入替换未明确保存的工作内容，即使等于上次修订也留下导入节点', () => {
    const store = createPostStore(database)
    const saved = store.createDraft(content)
    const initial = writer.getWorkingCopy(saved.id)
    assert.ok(initial)
    written(writer.write(command(initial, { content: { ...content, body: '自动保存' } })))
    const imported = store.importDraft({ ...content, id: saved.id })
    expect(imported.revisionId).not.toBe(saved.revisionId)
    expect(store.listRevisions(saved.id)[0].source).toBe('import')
    expect(writer.getWorkingCopy(saved.id)).toMatchObject(content)
  })

  it('仅持修订基线的写入不能覆盖尚未明确保存的工作稿', () => {
    const store = createPostStore(database)
    const saved = store.createDraft(content)
    const first = writer.getWorkingCopy(saved.id)
    assert.ok(first)
    const pending = written(writer.write(command(first, { content: { ...content, body: '自动保存' } })))
    expect(store.saveDraft(saved.id, content, saved.revisionId)).toEqual({ status: 'conflict' })
    expect(store.publishDraft(saved.id, content, saved.revisionId)).toEqual({ status: 'conflict' })
    expect(store.restoreRevision(saved.id, saved.revisionId, saved.revisionId)).toEqual({ status: 'conflict' })
    expect(writer.getWorkingCopy(saved.id)).toEqual(pending)
  })
})

describe('操作回执', () => {
  it('提交后丢失响应的重试返回原确认，不追加修订和发布事件', () => {
    const input = command(null, { intent: 'publish' })
    const original = writer.write(input)
    expect(writer.write(input)).toEqual(original)
    const first = written(original)
    const latest = written(writer.write(command(first, { content: { ...content, body: '更新' } })))
    expect(writer.write(input)).toEqual(original)
    expect(writer.getWorkingCopy(first.id)).toEqual(latest)
    expect(createPostStore(database).listRevisions(first.id)).toHaveLength(1)
    expect(createPostStore(database).listPublications(first.id)).toHaveLength(1)
    expect(database.select().from(postWriteReceipts).all()).toHaveLength(2)
  })

  it('同一操作 ID 不得改正文、命令、文档或基线，顺序不同的对象仍是同一请求', () => {
    const input = command(null)
    const original = writer.write(input)
    for (const patch of [
      { content: { ...content, body: '不同' } }, { intent: 'save' as const },
      { postId: randomUUID() }, { expectedVersion: 'different' },
    ]) expect(writer.write({ ...input, ...patch }).status).toBe('invalid')
    expect(writer.write({ ...input, content: { body: content.body, title: content.title, description: content.description } })).toEqual(original)
    expect(database.select().from(postWriteReceipts).all()).toHaveLength(1)
  })

  it('回执失败时工作稿、身份、修订和发布全部回滚', () => {
    database.$client.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON post_write_receipts
      BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`)
    const input = command(null, { intent: 'publish' })
    expect(() => writer.write(input)).toThrow('receipt unavailable')
    expect(writer.getWorkingCopy(input.postId)).toBeNull()
    expect(createPostStore(database).listPosts()).toEqual([])
    expect(createPostStore(database).listRevisions(input.postId)).toEqual([])
    database.$client.exec('DROP TRIGGER reject_receipt')
    expect(writer.write(input).status).toBe('success')
  })

  it('回执不存正文且不可被 UPDATE，文章删除仍能级联释放', () => {
    const input = command(null)
    written(writer.write(input))
    const receipt = database.select().from(postWriteReceipts).get()
    expect(receipt).not.toHaveProperty('body')
    expect(() => database.$client.exec("UPDATE post_write_receipts SET version = 'changed'"))
      .toThrow('Post write receipts are immutable')
    database.$client.prepare('DELETE FROM posts WHERE id = ?').run(input.postId)
    expect(database.select().from(postWriteReceipts).all()).toEqual([])
  })

  it('外部输入拒绝系统字段和非法操作身份', () => {
    expect(writingCommandSchema.safeParse({ ...command(null), operationId: 'bad' }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), unexpected: true }).success).toBe(false)
    expect(writer.write(command(null, { postId: 'not-a-uuid' })).status).toBe('invalid')
  })
})
