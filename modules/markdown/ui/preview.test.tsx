import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownContent } from '../server/content'
import { MarkdownPreview } from './preview'

vi.mock('server-only', () => ({}))

describe('正文与预览语义一致', () => {
  it('同一文本产生相同的 GFM、标题锚点、安全策略与多语言代码结果', async () => {
    const source = '# 中文标题\n\nA **bold** paragraph.\n\n| Name | Value |\n| --- | --- |\n| One | 1 |\n\n```rust\nfn main() {}\n```\n\n<script>alert(1)</script>\n'
    const server = render(await MarkdownContent({ source }))
    const expected = server.container.innerHTML
    server.unmount()
    const preview = render(<MarkdownPreview source={source} />)
    await screen.findByRole('heading', { name: /中文标题/ })
    expect(preview.container.innerHTML).toBe(expected)
    expect(preview.container.querySelector('script')).toBeNull()
  })

  it('更新文本后丢弃旧结果，不把先前预览留作当前正文', async () => {
    const { container, rerender } = render(<MarkdownPreview source="# First" />)
    await screen.findByRole('heading', { name: /First/ })
    rerender(<MarkdownPreview source="# Second" />)
    await screen.findByRole('heading', { name: /Second/ })
    await waitFor(() => expect(container.textContent).not.toContain('First'))
  })

  it('连续修改期间保留上一次结果，只渲染停顿后的文本', async () => {
    const { container, rerender } = render(<MarkdownPreview source="# First" />)
    await screen.findByRole('heading', { name: /First/ })
    const seen: string[] = []
    const observer = new MutationObserver(() => seen.push(container.textContent ?? ''))
    observer.observe(container, { childList: true, subtree: true, characterData: true })

    vi.useFakeTimers()
    try {
      for (const source of ['# Second', '# Third', '# Fourth']) {
        rerender(<MarkdownPreview source={source} />)
        await vi.advanceTimersByTimeAsync(50)
      }
      expect(container.textContent).toContain('First')
      await vi.advanceTimersByTimeAsync(1000)
    } finally {
      vi.useRealTimers()
    }

    await screen.findByRole('heading', { name: /Fourth/ })
    observer.disconnect()
    expect(seen.some(text => /Second|Third/.test(text))).toBe(false)
  })
})
