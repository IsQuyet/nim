import { describe, expect, it } from 'vitest'
import type { PublishedGalleryItem } from '@/modules/gallery/model'
import { executeSiteSearch, parseSearchTerms, stripMarkdownForSearch } from './engine'

const samplePosts = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: '为什么想找一款记账软件，最后却让我思考起了数据的开放？',
    description: '个人财务数据的可携带性与 Next.js 实践。',
    body: '![cover](/media/22222222-2222-4222-8222-222222222222)\n\n正文讨论 Next.js 应用里的记账流水导出与授权边界。',
    publishedAt: '2026-11-20T00:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Random notes',
    description: 'A long rambling note',
    body: '记账 记账 记账 记账 记账 repeated only in the body without that framework.',
    publishedAt: '2026-11-22T00:00:00.000Z',
  },
]

const sampleGallery: PublishedGalleryItem[] = [
  {
    id: '44444444-4444-4444-8444-444444444444',
    mediaId: '55555555-5555-4555-8555-555555555555',
    title: 'Harbor Dawn',
    caption: 'Early ferry before rain.',
    location: 'Kobe',
    takenAt: '2026-10-12',
    status: 'published',
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    publishedAt: '2026-11-18T00:00:00.000Z',
    media: {
      id: '55555555-5555-4555-8555-555555555555',
      originalName: 'harbor.webp',
      mediaType: 'image/webp',
      width: 1200,
      height: 800,
    },
  },
]

describe('站内搜索引擎与分词打分', () => {
  it('支持短中文词、带标点英文词以及大小写去重分词', () => {
    expect(parseSearchTerms('  Next.js   记账  next.js  ')).toEqual(['Next.js', '记账'])
    expect(parseSearchTerms('   ')).toEqual([])
  })

  it('剥离 Markdown 图片链接和语法符号，不误命中内部路径', () => {
    const plain = stripMarkdownForSearch('# 标题\n\n![cover](/media/22222222-2222-4222-8222-222222222222)\n\n看[文档](https://example.com)')
    expect(plain).toBe('标题 cover 看文档')
    expect(plain).not.toContain('/media/')
  })

  it('标题命中权重高于仅正文高频命中，同时支持 2 字中文与标点精确查询', () => {
    const zhTwoChars = executeSiteSearch({
      query: '记账',
      scope: 'all',
      limit: 10,
      posts: samplePosts,
      gallery: sampleGallery,
    })
    expect(zhTwoChars.counts).toEqual({ all: 2, posts: 2, gallery: 0 })
    expect(zhTwoChars.hits[0]?.id).toBe('11111111-1111-4111-8111-111111111111')

    const mixed = executeSiteSearch({
      query: 'Next.js 记账',
      scope: 'all',
      limit: 10,
      posts: samplePosts,
      gallery: sampleGallery,
    })
    expect(mixed.hits).toHaveLength(1)
    expect(mixed.hits[0]?.titleSegments.some(segment => segment.matched && segment.text === '记账')).toBe(true)
  })

  it('按范围筛选结果时保留跨类型计数统计，并支持按画廊地点检索', () => {
    const result = executeSiteSearch({
      query: 'Kobe',
      scope: 'posts',
      limit: 10,
      posts: samplePosts,
      gallery: sampleGallery,
    })
    expect(result.counts).toEqual({ all: 1, posts: 0, gallery: 1 })
    expect(result.total).toBe(0)
    expect(result.hits).toEqual([])

    const galleryResult = executeSiteSearch({
      query: 'Kobe',
      scope: 'gallery',
      limit: 10,
      posts: samplePosts,
      gallery: sampleGallery,
    })
    expect(galleryResult.hits).toHaveLength(1)
    expect(galleryResult.hits[0]).toMatchObject({ kind: 'gallery', location: 'Kobe' })
  })
})
