// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { withAdminWritingStore } from '@/lib/admin-posts'
import type { WorkingCopy, WritingCommand, WritingStore } from '@/lib/writing'
import { readWorkingCopyAction, writeWorkingCopyAction } from './writing-actions'

vi.mock('@/lib/admin-posts', () => ({ withAdminWritingStore: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const content = { title: 'Title', description: '', body: 'Body' }
const working: WorkingCopy = {
  id: randomUUID(), version: 'version', checkpointRevisionId: null,
  ...content, createdAt: '2026-11-15T12:00:00.000Z', updatedAt: '2026-11-15T12:00:00.000Z',
}
const store = { getWorkingCopy: vi.fn<WritingStore['getWorkingCopy']>(), write: vi.fn<WritingStore['write']>() }
function command(intent: WritingCommand['intent'] = 'autosave'): WritingCommand {
  return { postId: working.id, expectedVersion: 'version', operationId: randomUUID(), content, intent }
}

beforeEach(() => {
  vi.clearAllMocks()
  store.write.mockReturnValue({ status: 'success', value: { workingCopy: working, publication: null } })
  store.getWorkingCopy.mockReturnValue(working)
  vi.mocked(withAdminWritingStore).mockImplementation(async operation => ({ authorized: true, value: await operation(store) }))
})

describe('工作稿 Server Actions', () => {
  it('身份检查先于输入和存储，过期会话保留可重试反馈', async () => {
    vi.mocked(withAdminWritingStore).mockResolvedValue({ authorized: false })
    expect(await writeWorkingCopyAction(null)).toMatchObject({ status: 'error', signInRequired: true })
    expect(await readWorkingCopyAction(null)).toMatchObject({ status: 'error', signInRequired: true })
    expect(store.write).not.toHaveBeenCalled()
    expect(store.getWorkingCopy).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('非法输入不执行写入，自动保存允许空标题而明确命令拒绝', async () => {
    const auto = { ...command(), content: { ...content, title: '' } }
    await writeWorkingCopyAction(auto)
    expect(store.write).toHaveBeenCalledWith(auto)
    store.write.mockClear()
    for (const input of [null, { ...auto, intent: 'save' }, { ...auto, intent: 'publish' }, { ...auto, operationId: 'bad' }]) {
      expect(await writeWorkingCopyAction(input)).toMatchObject({ status: 'invalid' })
    }
    expect(store.write).not.toHaveBeenCalled()
  })

  it('自动保存只使管理列表失效，不刷新公开或当前编辑器', async () => {
    const input = command()
    await writeWorkingCopyAction(input)
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith('/admin')
  })

  it.each(['save', 'publish'] as const)('明确 %s 刷新对应私有页面，只有发布刷新公开页面', async intent => {
    const input = command(intent)
    await writeWorkingCopyAction(input)
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path)
    expect(paths).toEqual([
      '/admin', `/admin/posts/${working.id}`, `/admin/posts/${working.id}/history`,
      ...(intent === 'publish' ? ['/', `/blog/${working.id}`, '/sitemap.xml'] : []),
    ])
  })

  it('冲突保留服务器当前副本，不刷新页面', async () => {
    store.write.mockReturnValue({ status: 'conflict', current: working })
    expect(await writeWorkingCopyAction(command())).toEqual({ status: 'conflict', current: working })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('普通故障不伪装成未登录或确定未提交', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.write.mockImplementation(() => { throw new Error('receipt unavailable') })
    expect(await writeWorkingCopyAction(command())).toMatchObject({ status: 'error', message: expect.stringContaining('Could not confirm') })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('框架控制流原样传播', async () => {
    store.write.mockImplementation(() => redirect('/admin/login'))
    await expect(writeWorkingCopyAction(command())).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) })
  })

  it('远端读取区分不存在、无效身份与故障，不前移编辑基线', async () => {
    expect(await readWorkingCopyAction(working.id)).toEqual({ status: 'success', value: working })
    store.getWorkingCopy.mockReturnValue(null)
    expect(await readWorkingCopyAction('missing')).toEqual({ status: 'success', value: null })
    store.getWorkingCopy.mockClear()
    expect(await readWorkingCopyAction(null)).toMatchObject({ status: 'error' })
    expect(store.getWorkingCopy).not.toHaveBeenCalled()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.getWorkingCopy.mockImplementation(() => { throw new Error('unavailable') })
    expect(await readWorkingCopyAction(working.id)).toMatchObject({ status: 'error', message: expect.stringContaining('Could not check') })
    log.mockRestore()
  })
})
