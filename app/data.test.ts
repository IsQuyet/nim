import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLOG_POSTS } from './data'

describe('首页文章索引', () => {
  it('每条入口都有对应文章路由，链接和标识不重复', () => {
    expect(new Set(BLOG_POSTS.map(post => post.uid)).size).toBe(BLOG_POSTS.length)
    expect(new Set(BLOG_POSTS.map(post => post.link)).size).toBe(BLOG_POSTS.length)
    const appDirectory = dirname(fileURLToPath(import.meta.url))
    for (const post of BLOG_POSTS) {
      const file = resolve(appDirectory, post.link.slice(1), 'page.mdx')
      expect(existsSync(file), post.link).toBe(true)
    }
  })
})
