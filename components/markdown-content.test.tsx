import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { MarkdownContent } from './markdown-content'

describe('Markdown 正文', () => {
  it('显示正文、GFM 内容及代码高亮', async () => {
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
    const { container } = render(await MarkdownContent({ source }))

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

  it('各级正文标题都有可访问的定位链接，同名标题去重且重新渲染后地址一致', async () => {
    const source = [
      '# Hello, **world**!',
      '## 数据开放',
      '### 数据开放',
      '#### Four `words`',
      '##### Fifth',
      '###### Sixth',
    ].join('\n\n')
    const ids = ['hello-world', '数据开放', '数据开放-1', 'four-words', 'fifth', 'sixth']
    const { rerender } = render(await MarkdownContent({ source }))

    const headings = screen.getAllByRole('heading')
    expect(headings.map(heading => heading.id)).toEqual(ids)
    for (const [index, heading] of headings.entries()) {
      const link = within(heading).getByRole('link', { name: 'Link to this section' })
      expect(link.getAttribute('href')).toBe(`#${ids[index]}`)
      expect(link.textContent).toBe('#')
      expect((link as HTMLAnchorElement).tabIndex).toBe(0)
    }

    rerender(await MarkdownContent({ source }))
    expect(screen.getAllByRole('heading').map(heading => heading.id)).toEqual(ids)
  })

  it.each([
    ['rust', 'fn main() { println!("hello"); }', 'fn'],
    ['sql', 'SELECT title FROM posts WHERE id = 1;', 'SELECT'],
    ['bash', 'echo "$HOME"', 'echo'],
    ['ts', 'interface Post { title: string }', 'interface'],
  ])('按 %s 语言识别语法关键字并保留代码原文', async (language, source, keyword) => {
    const { container } = render(await MarkdownContent({ source: `\`\`\`${language}\n${source}\n\`\`\`` }))
    expect(container.querySelector('pre code')?.textContent?.trimEnd()).toBe(source)
    const tokens = Array.from(container.querySelectorAll('pre code span[style]'))
    expect(tokens.some(token => token.textContent === keyword)).toBe(true)
  })

  it('未知语言与无语言代码保持纯文本，行内代码不猜测为 JavaScript', async () => {
    const source = 'Inline `const value = 1`.\n\n```unknown-language\nfn main() {}\n```\n\n```\nplain text\n```'
    const { container } = render(await MarkdownContent({ source }))
    const blocks = container.querySelectorAll('pre code')
    expect(blocks[0].textContent?.trimEnd()).toBe('fn main() {}')
    expect(blocks[1].textContent?.trimEnd()).toBe('plain text')
    expect(Array.from(blocks[0].querySelectorAll('span[style]')).some(token => token.textContent === 'fn')).toBe(false)
    expect(container.querySelector('p code')?.textContent).toBe('const value = 1')
    expect(container.querySelector('p code span')).toBeNull()
  })

  it('代码块保留内部空行，代码围栏的额外文本不改变渲染策略', async () => {
    const { container } = render(await MarkdownContent({ source: '```js {1-3} title="Example"\nconst first = 1\n\nconst second = 2\n```' }))
    expect(container.querySelector('pre code')?.textContent).toBe('const first = 1\n\nconst second = 2')
    expect(container.querySelector('[data-highlighted-line]')).toBeNull()
    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('代码中的 HTML 作为代码显示，不变成可执行节点', async () => {
    const code = '<script>alert("example")</script>\n<Widget />'
    const { container } = render(await MarkdownContent({ source: `\`\`\`html\n${code}\n\`\`\`` }))
    expect(container.querySelector('pre code')?.textContent).toBe(code)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('widget')).toBeNull()
  })

  it('正文是内容，不执行 JavaScript 表达式或渲染原始 HTML', async () => {
    const source = `Value: {1 + 1}

<script>alert('example')</script>

<Widget />
`
    const { container } = render(await MarkdownContent({ source }))

    expect(screen.getByText('Value: {1 + 1}')).toBeDefined()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('widget')).toBeNull()
  })
})
