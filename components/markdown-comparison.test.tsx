import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PublishedPost } from '@/modules/posts/model'
import { MarkdownComparison } from './markdown-comparison'

vi.mock('@/modules/markdown/ui/preview-loader', () => ({
  MarkdownPreviewLoader: ({ source }: { source: string }) => <div>{source}</div>,
}))

const published: PublishedPost = {
  id: '264efa5a-5f48-4f4d-bbc3-56021a5f6342',
  revisionId: 4,
  publicationId: 3,
  title: 'Published title',
  description: 'Published summary',
  body: '# Published body',
  createdAt: '2026-11-15T01:00:00.000Z',
  publishedAt: '2026-11-15T02:00:00.000Z',
}

const compared = {
  label: 'Current editor text',
  revisionId: null,
  detail: 'Draft baseline revision 6',
  title: 'Current title',
  description: 'Current summary',
  body: '# Current body',
}

describe('Markdown 发布版本对照', () => {
  it('在正常阅读布局中并排展示发布快照与当前内容的三个字段', () => {
    render(<MarkdownComparison published={published} compared={compared} />)
    const comparison = screen.getByRole('region', { name: 'Rendered version comparison' })
    const before = within(comparison).getByRole('article', { name: 'Published version' })
    const after = within(comparison).getByRole('article', { name: 'Current editor text' })

    expect(within(before).getByText('Published title')).toBeDefined()
    expect(within(before).getByText('Published summary')).toBeDefined()
    expect(within(before).getByText('# Published body')).toBeDefined()
    expect(within(after).getByText('Current title')).toBeDefined()
    expect(within(after).getByText('Current summary')).toBeDefined()
    expect(within(after).getByText('# Current body')).toBeDefined()
    expect(within(comparison).queryByText('no content differences', { exact: false })).toBeNull()
  })

  it('相同内容明确显示没有差异', () => {
    render(<MarkdownComparison published={published} compared={{
      ...compared,
      title: published.title,
      description: published.description,
      body: published.body,
    }} />)

    expect(screen.getByRole('status').textContent).toBe('These versions have no content differences.')
  })

  it('未发布文章不伪造基线，仍可预览当前内容', () => {
    render(<MarkdownComparison published={null} compared={compared} />)
    const comparison = screen.getByRole('region', { name: 'Rendered version comparison' })

    expect(within(comparison).getByRole('status').textContent).toBe('This post has not been published yet.')
    expect(within(comparison).queryByRole('article', { name: 'Published version' })).toBeNull()
    expect(within(comparison).getByRole('article', { name: 'Current editor text' })).toBeDefined()
  })
})
