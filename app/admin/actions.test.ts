// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreRevisionAction } from './actions'

const mocks = vi.hoisted(() => ({ withAdminPostStore: vi.fn(), restoreRevision: vi.fn(), revalidatePath: vi.fn(), redirect: vi.fn() }))
vi.mock('@/lib/admin-posts', () => ({ withAdminPostStore: mocks.withAdminPostStore }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(), redirect: mocks.redirect,
}))
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const input = { revisionId: 4, expectedRevisionId: 1, expectedWorkingVersion: 'working-version' }

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.withAdminPostStore.mockImplementation(async operation => ({ authorized: true, value: await operation({ restoreRevision: mocks.restoreRevision }) }))
  mocks.restoreRevision.mockReturnValue({ status: 'success', value: { id } })
  mocks.redirect.mockImplementation(path => { throw new Error(`Redirect: ${path}`) })
})

describe('修订恢复入口', () => {
  it('先鉴权，过期会话不解析绑定参数或查询稿件', async () => {
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    const read = vi.fn(() => { throw new Error('Must not parse before auth') })
    expect(await restoreRevisionAction(id, Object.defineProperty({}, 'revisionId', { get: read }), { status: 'idle' })).toEqual({
      status: 'error', message: 'Sign in to restore this revision.', signInRequired: true,
    })
    expect(read).not.toHaveBeenCalled()
    expect(mocks.restoreRevision).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    null, {},
    { ...input, revisionId: '4' }, { ...input, revisionId: 0 },
    { ...input, expectedRevisionId: null }, { ...input, expectedRevisionId: 1.5 },
    { revisionId: 4, expectedRevisionId: 1 }, { ...input, expectedWorkingVersion: '' },
  ])('非法或缺失编辑基线拒绝写入：%j', async invalid => {
    expect((await restoreRevisionAction(id, invalid, { status: 'idle' })).status).toBe('error')
    expect(mocks.restoreRevision).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('绑定目标与完整编辑基线，成功后仅刷新管理页面并导航', async () => {
    await expect(restoreRevisionAction(id, input, { status: 'idle' })).rejects.toThrow(`Redirect: /admin/posts/${id}`)
    expect(mocks.restoreRevision).toHaveBeenCalledExactlyOnceWith(id, 4, 1, 'working-version')
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin'], [`/admin/posts/${id}`], [`/admin/posts/${id}/history`]])
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/admin/posts/${id}`)
  })

  it.each([
    ['missing', 'This draft or revision does not exist.'],
    ['conflict', 'This draft changed while you were viewing history. Reload the history page before restoring.'],
  ])('%s保留历史页面，不刷新或强制恢复', async (status, message) => {
    mocks.restoreRevision.mockReturnValue({ status })
    expect(await restoreRevisionAction(id, input, { status: 'idle' })).toEqual({ status: 'error', message })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each(['authentication', 'storage'])('%s故障使用安全错误反馈，不冒充未登录', async source => {
    const error = new Error('Storage unavailable')
    if (source === 'authentication') mocks.withAdminPostStore.mockRejectedValue(error)
    else mocks.restoreRevision.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await restoreRevisionAction(id, input, { status: 'idle' })).toEqual({ status: 'error', message: 'Could not restore the revision. Please try again.' })
    expect(log).toHaveBeenCalledWith('恢复草稿修订失败。', error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('Next控制流原样传播，不记录为普通数据库故障', async () => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/login') } catch (error) { signal = error }
    mocks.withAdminPostStore.mockRejectedValue(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(restoreRevisionAction(id, input, { status: 'idle' })).rejects.toBe(signal)
    expect(log).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
