// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { deleteSiteAdminMedia, withAdminSiteMediaDatabase } from '../media-admin'
import { deleteMediaAssetAction } from './media'

vi.mock('../media-admin', () => ({
  withAdminSiteMediaDatabase: vi.fn(),
  deleteSiteAdminMedia: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mediaId = randomUUID()
const db = {} as never
const storage = {} as never

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(withAdminSiteMediaDatabase).mockImplementation(async operation => ({
    authorized: true,
    value: await operation(db, storage),
  }))
  vi.mocked(deleteSiteAdminMedia).mockResolvedValue({ status: 'success', id: mediaId })
})

describe('全站媒体删除 Server Action', () => {
  it('先鉴权，未登录不调用删除逻辑', async () => {
    vi.mocked(withAdminSiteMediaDatabase).mockResolvedValue({ authorized: false })
    expect(await deleteMediaAssetAction(mediaId)).toEqual({
      status: 'error',
      message: 'Sign in to manage media.',
      signInRequired: true,
    })
    expect(deleteSiteAdminMedia).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('删除成功后刷新媒体管理页面', async () => {
    expect(await deleteMediaAssetAction(mediaId)).toEqual({ status: 'success', id: mediaId })
    expect(deleteSiteAdminMedia).toHaveBeenCalledWith(db, storage, mediaId)
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith('/admin/media')
  })

  it('被引用、缺失或非法 ID 返回可见错误，不刷新页面', async () => {
    vi.mocked(deleteSiteAdminMedia).mockResolvedValueOnce({ status: 'referenced', message: 'In use.' })
    expect(await deleteMediaAssetAction(mediaId)).toEqual({ status: 'error', message: 'In use.' })

    vi.mocked(deleteSiteAdminMedia).mockResolvedValueOnce({ status: 'missing' })
    expect(await deleteMediaAssetAction(mediaId)).toEqual({ status: 'error', message: 'This media asset no longer exists.' })

    vi.mocked(deleteSiteAdminMedia).mockResolvedValueOnce({ status: 'invalid', message: 'Invalid media ID.' })
    expect(await deleteMediaAssetAction('bad')).toEqual({ status: 'error', message: 'Invalid media ID.' })

    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('意外故障记录日志并返回安全提示', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(deleteSiteAdminMedia).mockRejectedValue(new Error('Disk unavailable'))
    expect(await deleteMediaAssetAction(mediaId)).toEqual({
      status: 'error',
      message: 'Could not delete the media file. Please try again.',
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
