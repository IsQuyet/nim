// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withAdminWritingStore } from '../admin'
import type { DraftPost } from '../../model'
import type { WritingCommand, WritingStore } from '../../writing'
import { inspectDraftOperationAction, readDraftAction, writeDraftAction } from './writing'

vi.mock('../admin', () => ({ withAdminWritingStore: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const content = { title: 'Title', description: '', body: 'Body' }
const draft: DraftPost = {
  id: randomUUID(), revisionId: 1,
  ...content, createdAt: '2026-11-15T12:00:00.000Z', updatedAt: '2026-11-15T12:00:00.000Z',
}
const acknowledgement = { draft, publication: null }
const store = {
  getDraft: vi.fn<WritingStore['getDraft']>(),
  write: vi.fn<WritingStore['write']>(),
  inspect: vi.fn<WritingStore['inspect']>(),
}
function command(intent: WritingCommand['intent'] = 'save'): WritingCommand {
  return { postId: draft.id, expectedRevisionId: draft.revisionId, operationId: randomUUID(), content, intent }
}

beforeEach(() => {
  vi.resetAllMocks()
  store.write.mockReturnValue({ status: 'success', value: acknowledgement })
  store.getDraft.mockReturnValue(draft)
  store.inspect.mockReturnValue({ status: 'success', value: acknowledgement })
  vi.mocked(withAdminWritingStore).mockImplementation(async operation => ({ authorized: true, value: await operation(store) }))
})

describe('明确草稿 Server Actions', () => {
  it('三个入口都先鉴权再解析，过期会话不访问输入或存储', async () => {
    vi.mocked(withAdminWritingStore).mockResolvedValue({ authorized: false })
    const read = vi.fn(() => { throw new Error('Must not parse before auth') })
    const input = Object.defineProperty({}, 'postId', { get: read })
    expect(await writeDraftAction(input)).toEqual({ status: 'error', message: 'Sign in to save or publish this draft.', signInRequired: true })
    expect(await readDraftAction(input)).toMatchObject({ status: 'error', signInRequired: true })
    expect(await inspectDraftOperationAction(input)).toMatchObject({ status: 'error', signInRequired: true })
    expect(read).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(store.getDraft).not.toHaveBeenCalled()
    expect(store.inspect).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('拒绝非法或自动写入命令、未完成标题和旧版本字段，不执行存储', async () => {
    for (const input of [
      null,
      { ...command(), intent: 'autosave' },
      { ...command(), expectedVersion: 'version' },
      { ...command(), operationId: 'bad' },
      { ...command(), expectedRevisionId: undefined },
      ...(['save', 'publish'] as const).map(intent => ({ ...command(intent), content: { ...content, title: '' } })),
    ]) expect(await writeDraftAction(input)).toMatchObject({ status: 'invalid' })
    expect(store.write).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['save', 'publish'] as const)('%s 成功刷新私有页面，只有发布刷新公开页面', async intent => {
    const input = command(intent)
    expect(await writeDraftAction(input)).toEqual({ status: 'success', value: acknowledgement })
    expect(store.write).toHaveBeenCalledExactlyOnceWith(input)
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path)
    expect(paths).toEqual([
      '/admin', `/admin/posts/${draft.id}`, `/admin/posts/${draft.id}/history`,
      ...(intent === 'publish' ? ['/', `/blog/${draft.id}`, '/sitemap.xml'] : []),
    ])
    expect(store.inspect).not.toHaveBeenCalled()
  })

  it('冲突保留服务器当前草稿，不刷新页面', async () => {
    store.write.mockReturnValue({ status: 'conflict', current: draft })
    expect(await writeDraftAction(command())).toEqual({ status: 'conflict', current: draft })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('普通写入故障不伪装成未登录或确定未提交，不自动重试或查询', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.write.mockImplementation(() => { throw new Error('receipt unavailable') })
    expect(await writeDraftAction(command())).toMatchObject({ status: 'error', message: expect.stringContaining('Could not confirm') })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(store.write).toHaveBeenCalledTimes(1)
    expect(store.inspect).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('读取明确草稿区分缺失、非法输入和普通故障，绝不刷新或写入', async () => {
    expect(await readDraftAction(draft.id)).toEqual({ status: 'success', value: draft })
    store.getDraft.mockReturnValue(null)
    expect(await readDraftAction('missing')).toEqual({ status: 'success', value: null })
    store.getDraft.mockClear()
    expect(await readDraftAction(null)).toMatchObject({ status: 'error' })
    expect(store.getDraft).not.toHaveBeenCalled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.getDraft.mockImplementation(() => { throw new Error('unavailable') })
    expect(await readDraftAction(draft.id)).toMatchObject({ status: 'error', message: expect.stringContaining('Could not check') })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(store.inspect).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('inspect 只按完整操作身份查询现有回执，成功和 unconfirmed 都不刷新或写入', async () => {
    const input = { postId: draft.id, operationId: randomUUID() }
    expect(await inspectDraftOperationAction(input)).toEqual({ status: 'success', value: acknowledgement })
    expect(store.inspect).toHaveBeenCalledExactlyOnceWith(input)
    store.inspect.mockReturnValue({ status: 'unconfirmed' })
    expect(await inspectDraftOperationAction(input)).toEqual({ status: 'unconfirmed' })
    store.inspect.mockReturnValue({ status: 'invalid', message: 'Wrong post.' })
    expect(await inspectDraftOperationAction(input)).toEqual({ status: 'invalid', message: 'Wrong post.' })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(store.getDraft).not.toHaveBeenCalled()
  })

  it('inspect 不接受写命令、缺失或非法身份，查询故障不冒充 unconfirmed', async () => {
    for (const input of [null, {}, command(), { postId: draft.id, operationId: 'bad' }]) {
      expect(await inspectDraftOperationAction(input)).toMatchObject({ status: 'invalid' })
    }
    expect(store.inspect).not.toHaveBeenCalled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.inspect.mockImplementation(() => { throw new Error('unavailable') })
    expect(await inspectDraftOperationAction({ postId: draft.id, operationId: randomUUID() }))
      .toMatchObject({ status: 'error', message: expect.stringContaining('Could not check') })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it.each(['write', 'read', 'inspect'] as const)('%s 的框架控制流原样传播', async operation => {
    const signal = () => redirect('/admin/login')
    store.write.mockImplementation(signal)
    store.getDraft.mockImplementation(signal)
    store.inspect.mockImplementation(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const input = command()
    const request = operation === 'write' ? writeDraftAction(input)
      : operation === 'read' ? readDraftAction(input.postId)
        : inspectDraftOperationAction({ postId: input.postId, operationId: input.operationId })
    await expect(request).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) })
    expect(log).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    log.mockRestore()
  })
})
