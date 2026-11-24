import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteMediaItem } from '@/modules/site/media'
import AdminMediaPage from './page'

const mocks = vi.hoisted(() => ({
  getSiteAdminMedia: vi.fn(),
  deleteMediaAssetAction: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/modules/site/server/media-admin', () => ({ getSiteAdminMedia: mocks.getSiteAdminMedia }))
vi.mock('@/modules/site/server/actions/media', () => ({ deleteMediaAssetAction: mocks.deleteMediaAssetAction }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ replace: vi.fn(), refresh: mocks.refresh }),
}))

const unusedId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const usedId = '68767e8c-c86e-4b97-bb15-356c2553f49c'
const galleryMediaId = '7b4831f4-8e2a-43e1-9254-3e1da354d001'
const postId = '9ea8d4be-4b45-46d2-954c-3e1da354d33f'
const galleryId = 'c34e9f20-12a4-47f0-98a0-1234567890ab'

function makeItems(): SiteMediaItem[] {
  return [
    {
      asset: {
        id: unusedId,
        originalName: 'unused.png',
        mediaType: 'image/webp',
        byteSize: 2048,
        width: 800,
        height: 600,
        sha256: 'a'.repeat(64),
        state: 'ready',
        createdAt: '2026-11-16T00:00:00.000Z',
      },
      postReferences: [],
      galleryReferences: [],
    },
    {
      asset: {
        id: usedId,
        originalName: 'diagram.png',
        mediaType: 'image/webp',
        byteSize: 4096,
        width: 1200,
        height: 800,
        sha256: 'b'.repeat(64),
        state: 'ready',
        createdAt: '2026-11-15T00:00:00.000Z',
      },
      postReferences: [{
        postId,
        title: 'Referenced post',
        inDraft: true,
        inPublished: true,
        publicationCount: 1,
      }],
      galleryReferences: [],
    },
    {
      asset: {
        id: galleryMediaId,
        originalName: 'harbor.png',
        mediaType: 'image/webp',
        byteSize: 8192,
        width: 1600,
        height: 1200,
        sha256: 'c'.repeat(64),
        state: 'ready',
        createdAt: '2026-11-14T00:00:00.000Z',
      },
      postReferences: [],
      galleryReferences: [{
        galleryId,
        title: 'Harbor Dawn',
        status: 'published',
      }],
    },
  ]
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSiteAdminMedia.mockResolvedValue(makeItems())
  mocks.deleteMediaAssetAction.mockResolvedValue({ status: 'success', id: unusedId })
})

describe('管理员媒体管理页', () => {
  it('未登录时由鉴权守卫抛出重定向', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.getSiteAdminMedia.mockRejectedValue(denied)
    await expect(AdminMediaPage()).rejects.toBe(denied)
  })

  it('无媒体时显示空状态', async () => {
    mocks.getSiteAdminMedia.mockResolvedValue([])
    render(await AdminMediaPage())
    expect(screen.getByText('No media uploaded yet.')).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Media assets' })).toBeNull()
  })

  it('展示文章与画廊的引用链接，并仅允许删除未被引用的资源', async () => {
    render(await AdminMediaPage())
    const cards = within(screen.getByRole('list', { name: 'Media assets' })).getAllByRole('listitem')
      .filter(el => el.parentElement?.getAttribute('aria-label') === 'Media assets')
    expect(cards).toHaveLength(3)

    expect(within(cards[0]).getByText('Not referenced')).toBeDefined()
    const deleteButton = within(cards[0]).getByRole('button', { name: 'Delete' })

    expect(within(cards[1]).getByRole('link', { name: 'Referenced post' }).getAttribute('href')).toBe(`/admin/posts/${postId}`)
    expect(within(cards[1]).getByRole('link', { name: 'Published' }).getAttribute('href')).toBe(`/blog/${postId}`)
    expect(within(cards[1]).queryByRole('button', { name: 'Delete' })).toBeNull()

    expect(within(cards[2]).getByRole('link', { name: 'Gallery: Harbor Dawn' }).getAttribute('href')).toBe('/admin/gallery')
    expect(within(cards[2]).getByRole('link', { name: 'Published' }).getAttribute('href')).toBe(`/gallery/${galleryId}`)
    expect(within(cards[2]).queryByRole('button', { name: 'Delete' })).toBeNull()

    fireEvent.click(deleteButton)
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.deleteMediaAssetAction).toHaveBeenCalledWith(unusedId))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
