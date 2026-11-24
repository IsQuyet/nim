import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { extractMarkdownHeadings } from './headings'

vi.mock('server-only', () => ({}))
import { MarkdownContent } from './server/content'

describe('extractMarkdownHeadings', () => {
  it('提取二级与三级标题，生成与正文渲染完全一致的去重锚点', async () => {
    const source = [
      '# Hello, **world**!',
      '## 数据开放',
      '### 数据开放',
      '## Inline `code` and [link](https://example.com)',
      '#### Deep heading ignored',
      '```md\n## Heading inside code block\n```',
      'Footnote reference.[^note]',
      '[^note]: Note text.',
    ].join('\n\n')

    const headings = extractMarkdownHeadings(source)
    expect(headings).toEqual([
      { id: '数据开放', text: '数据开放', depth: 2 },
      { id: '数据开放-1', text: '数据开放', depth: 3 },
      { id: 'inline-code-and-link', text: 'Inline code and link', depth: 2 },
    ])

    render(await MarkdownContent({ source }))
    for (const heading of headings) {
      const rendered = document.getElementById(heading.id)
      expect(rendered?.tagName).toBe(`H${heading.depth}`)
      expect(rendered?.textContent?.replace(/#$/, '').trim()).toBe(heading.text)
    }
  })

  it('若一级标题与二级标题同名，二级标题仍遵循全局去重编号', async () => {
    const source = '# Overview\n\n## Overview\n'
    const headings = extractMarkdownHeadings(source)
    expect(headings).toEqual([{ id: 'overview-1', text: 'Overview', depth: 2 }])

    render(await MarkdownContent({ source }))
    expect(document.getElementById('overview-1')?.tagName).toBe('H2')
  })

  it('忽略空标题并在无目录标题时返回空列表', () => {
    expect(extractMarkdownHeadings('# Only title\n\n##   \n\nParagraph text.')).toEqual([])
  })
})
