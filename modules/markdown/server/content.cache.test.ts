// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pipeline = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('react-markdown', () => ({ MarkdownAsync: pipeline.run, defaultUrlTransform: (url: string) => url }))

let renderMarkdown: typeof import('./content').renderMarkdown
let budget: number

beforeEach(async () => {
  vi.resetModules()
  pipeline.run.mockReset().mockImplementation(async ({ children }: { children: string }) => ({ rendered: children.length }))
  const content = await import('./content')
  renderMarkdown = content.renderMarkdown
  budget = content.MAX_CACHED_CHARACTERS
})

describe('正文渲染结果复用', () => {
  it('相同正文只渲染一次，并发请求共用同一结果', async () => {
    const [first, second] = await Promise.all([renderMarkdown('# Same'), renderMarkdown('# Same')])
    expect(second).toBe(first)
    expect(await renderMarkdown('# Same')).toBe(first)
    expect(pipeline.run).toHaveBeenCalledTimes(1)
  })

  it('不同正文各自渲染，互不替代', async () => {
    const first = await renderMarkdown('# First')
    const second = await renderMarkdown('# Second')
    expect(second).not.toBe(first)
    expect(pipeline.run).toHaveBeenCalledTimes(2)
  })

  it('保留的正文总量超出上限时先放弃最久未读取的结果', async () => {
    const size = Math.floor(budget / 3)
    const posts = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(size))
    for (const post of posts.slice(0, 3)) await renderMarkdown(post)
    await renderMarkdown(posts[0])
    await renderMarkdown(posts[3])
    expect(pipeline.run).toHaveBeenCalledTimes(4)

    await renderMarkdown(posts[0])
    await renderMarkdown(posts[3])
    expect(pipeline.run).toHaveBeenCalledTimes(4)
    await renderMarkdown(posts[1])
    expect(pipeline.run).toHaveBeenCalledTimes(5)
  })

  it('单篇超过上限的正文每次重新渲染，不挤掉已保留的结果', async () => {
    await renderMarkdown('# Kept')
    const oversized = 'x'.repeat(budget + 1)
    await renderMarkdown(oversized)
    await renderMarkdown(oversized)
    expect(pipeline.run).toHaveBeenCalledTimes(3)
    await renderMarkdown('# Kept')
    expect(pipeline.run).toHaveBeenCalledTimes(3)
  })

  it('渲染失败原样抛出且不保留，下次重新渲染', async () => {
    const failure = new Error('language pack unavailable')
    pipeline.run.mockRejectedValueOnce(failure)
    await expect(renderMarkdown('# Flaky')).rejects.toBe(failure)
    await expect(renderMarkdown('# Flaky')).resolves.toEqual({ rendered: 7 })
    expect(pipeline.run).toHaveBeenCalledTimes(2)
  })
})
