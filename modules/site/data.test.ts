import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BLOG_POST_SOURCES } from './data'

describe('仓库文章导入素材', () => {
  it('素材 ID 和文件不重复，正文文件存在', () => {
    expect(new Set(BLOG_POST_SOURCES.map(post => post.id)).size).toBe(BLOG_POST_SOURCES.length)
    expect(new Set(BLOG_POST_SOURCES.map(post => post.file)).size).toBe(BLOG_POST_SOURCES.length)
    const directory = dirname(fileURLToPath(import.meta.url))
    for (const post of BLOG_POST_SOURCES) {
      const file = resolve(directory, '..', '..', 'content', 'blog', post.file)
      expect(existsSync(file), post.file).toBe(true)
    }
  })
})
