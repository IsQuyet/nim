import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ImportPage from './page'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(), randomUUID: vi.fn(), importMarkdownAction: vi.fn(),
}))
vi.mock('@/modules/auth/server/auth', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('node:crypto', async actual => ({
  ...await actual<typeof import('node:crypto')>(), randomUUID: mocks.randomUUID,
}))
vi.mock('./actions', () => ({ importMarkdownAction: mocks.importMarkdownAction }))

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.requireAdminSession.mockResolvedValue({})
  mocks.randomUUID.mockReturnValue('264efa5a-5f48-4f4d-bbc3-56021a5f6342')
})

describe('Markdown 导入页面', () => {
  it('先验证管理员身份，未通过时不生成导入会话或显示上传表单', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.requireAdminSession.mockRejectedValue(denied)
    await expect(ImportPage()).rejects.toBe(denied)
    expect(mocks.randomUUID).not.toHaveBeenCalled()
    expect(screen.queryByRole('form', { name: 'Import Markdown' })).toBeNull()
  })

  it('提供上传入口、最小样例与ID及草稿替换语义，不依赖文件名或直接发布', async () => {
    const { container } = render(await ImportPage())
    expect(mocks.requireAdminSession).toHaveBeenCalledTimes(1)
    expect(mocks.randomUUID).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Import Markdown' })).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('Markdown file').accept).toBe('.md,text/markdown')
    expect(screen.getByText(/Only the id field selects an existing article, never the filename/)).toBeDefined()
    expect(screen.getByText(/Description is optional and defaults to an empty string/)).toBeDefined()
    expect(screen.getByText(/The UTF-8 Markdown body is preserved exactly/)).toBeDefined()
    expect(container.querySelector('pre code')?.textContent).toBe('---\ntitle: Imported draft\n---\n\n# Markdown body\n')
    expect(screen.getByRole('link', { name: 'Back to posts' }).getAttribute('href')).toBe('/admin')
  })
})
