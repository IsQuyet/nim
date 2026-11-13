import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarkdownContent } from './markdown-content'

describe('Markdown 正文', () => {
  it('显示正文、GFM 内容及代码高亮', () => {
    const source = `# Article

A **bold** paragraph with [a link](/blog/another-post).

| Name | Value |
| --- | --- |
| Example | 1 |

- [x] Finished

~~Old text~~

A reference.[^note]

[^note]: Reference text.

\`\`\`js
const message = "hello"
\`\`\`
`
    const { container } = render(<MarkdownContent source={source} />)

    expect(screen.getByText('Article', { selector: 'h1' })).toBeDefined()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(screen.getByRole('link', { name: 'a link' }).getAttribute('href'))
      .toBe('/blog/another-post')
    expect(screen.getByRole('table')).toBeDefined()
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(container.querySelector('del')?.textContent).toBe('Old text')
    expect(container.querySelector('a[data-footnote-ref]')).not.toBeNull()
    expect(screen.getByText('Reference text.')).toBeDefined()
    expect(container.querySelector('[data-footnotes] h2 a')).toBeNull()
    expect(container.querySelector('pre code')?.textContent?.trimEnd())
      .toBe('const message = "hello"')
    expect(container.querySelector('pre code span')).not.toBeNull()
  })

  it('各级正文标题都有可访问的定位链接，同名标题去重且重新渲染后地址一致', () => {
    const source = [
      '# Hello, **world**!',
      '## 数据开放',
      '### 数据开放',
      '#### Four `words`',
      '##### Fifth',
      '###### Sixth',
    ].join('\n\n')
    const ids = ['hello-world', '数据开放', '数据开放-1', 'four-words', 'fifth', 'sixth']
    const { rerender } = render(<MarkdownContent source={source} />)

    const headings = screen.getAllByRole('heading')
    expect(headings.map(heading => heading.id)).toEqual(ids)
    for (const [index, heading] of headings.entries()) {
      const link = within(heading).getByRole('link', { name: 'Link to this section' })
      expect(link.getAttribute('href')).toBe(`#${ids[index]}`)
      expect(link.textContent).toBe('#')
      expect((link as HTMLAnchorElement).tabIndex).toBe(0)
    }

    rerender(<MarkdownContent source={source} />)
    expect(screen.getAllByRole('heading').map(heading => heading.id)).toEqual(ids)
  })

  it('正文是内容，不执行 JavaScript 表达式或渲染原始 HTML', () => {
    const source = `Value: {1 + 1}

<script>alert('example')</script>

<Widget />
`
    const { container } = render(<MarkdownContent source={source} />)

    expect(screen.getByText('Value: {1 + 1}')).toBeDefined()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('widget')).toBeNull()
  })
})
