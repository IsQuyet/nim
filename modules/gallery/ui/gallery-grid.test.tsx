import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PublishedGalleryItem } from '../model'
import { GalleryGrid } from './gallery-grid'

const items: PublishedGalleryItem[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    mediaId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'First Light',
    caption: 'Over the pier',
    location: 'Osaka',
    takenAt: '2026-10-01',
    status: 'published',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    publishedAt: '2026-10-01T00:00:00.000Z',
    media: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      originalName: 'first.webp',
      mediaType: 'image/webp',
      width: 1200,
      height: 800,
    },
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    mediaId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    title: 'Second Frame',
    caption: 'Night tram',
    location: 'Sapporo',
    takenAt: '2026-10-02',
    status: 'published',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    publishedAt: '2026-10-02T00:00:00.000Z',
    media: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      originalName: 'second.webp',
      mediaType: 'image/webp',
      width: 900,
      height: 1200,
    },
  },
]

describe('画廊网格与灯箱交互', () => {
  it('空状态提示无作品', () => {
    render(<GalleryGrid items={[]} />)
    expect(screen.getByText('No photos yet.')).toBeDefined()
  })

  it('点击作品打开灯箱，支持键盘左右翻页与独立详情链接', () => {
    render(<GalleryGrid items={items} variant="archive" />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview First Light' }))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.getByText('1 / 2')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open detail page' }).getAttribute('href'))
      .toBe('/gallery/11111111-1111-4111-8111-111111111111')

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 2')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Open detail page' }).getAttribute('href'))
      .toBe('/gallery/22222222-2222-4222-8222-222222222222')

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('1 / 2')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Close lightbox' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
