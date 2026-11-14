import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownPreviewLoader } from './markdown-preview-loader'

const preview = vi.hoisted(() => ({ fail: false }))
vi.mock('next/dynamic', () => ({
  default: () => function Preview({ source }: { source: string }) {
    if (preview.fail) throw new Error('Preview chunk unavailable')
    return <p>{source}</p>
  },
}))

beforeEach(() => { preview.fail = false })

describe('预览加载边界', () => {
  it('正常显示预览组件返回的内容', () => {
    render(<MarkdownPreviewLoader source="Preview source" />)
    expect(screen.getByText('Preview source')).toBeDefined()
  })

  it('预览资源失败只影响预览区，不卸载外部编辑内容', () => {
    preview.fail = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<><textarea aria-label="Local draft" defaultValue="Unsaved source" /><MarkdownPreviewLoader source="Preview source" /></>)
    expect(screen.getByRole('alert').textContent).toContain('Preview could not be loaded')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Local draft' }).value).toBe('Unsaved source')
  })
})
