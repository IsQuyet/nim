import { describe, expect, it } from 'vitest'
import { postContentSchema, samePostContent } from './model'

const content = {
  title: '  中文标题  ',
  description: '\nDescription.\r\n',
  body: '    indented code\r\n\n# 正文\n\n',
}

describe('文章内容契约', () => {
  it('保留原始标题、摘要、缩进和换行，不带入身份、时间或阶段', () => {
    expect(postContentSchema.parse({ ...content, id: 'another', stage: 'published', updatedAt: 'time' }))
      .toEqual(content)
  })

  it.each([null, [], {}, { ...content, body: 123 }, { ...content, description: null }, { ...content, title: ' \t\n' }])(
    '拒绝不满足文本内容契约的输入 %#', input => {
      expect(postContentSchema.safeParse(input).success).toBe(false)
    },
  )

  it('允许空摘要与空正文', () => {
    expect(postContentSchema.parse({ title: 'Title', description: '', body: '' }))
      .toEqual({ title: 'Title', description: '', body: '' })
  })

  it('内容相等只取决于全部内容字段，保留原文差异', () => {
    expect(samePostContent(content, { ...content })).toBe(true)
    expect(samePostContent(content, { ...content, title: content.title.trim() })).toBe(false)
    expect(samePostContent(content, { ...content, description: '' })).toBe(false)
    expect(samePostContent(content, { ...content, body: content.body.replaceAll('\r\n', '\n') })).toBe(false)
  })
})
