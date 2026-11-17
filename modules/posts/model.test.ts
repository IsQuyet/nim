import { describe, expect, it } from 'vitest'
import { postContentSchema, restoreRevisionSchema, revisionHistoryQuerySchema, samePostContent } from './model'

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

  it('历史查询将规范数字字符串解析为修订与页码，不接受歧义数组或非整数', () => {
    expect(revisionHistoryQuerySchema.parse({})).toEqual({ page: 1 })
    expect(revisionHistoryQuerySchema.parse({ page: '2', revisionId: '3' })).toEqual({ page: 2, revisionId: 3 })
    for (const value of ['', '0', '-1', '1.5', '1e3', '9007199254740992', ['1']]) {
      expect(revisionHistoryQuerySchema.safeParse({ page: value }).success).toBe(false)
      expect(revisionHistoryQuerySchema.safeParse({ revisionId: value }).success).toBe(false)
    }
  })

  it('恢复命令明确绑定目标修订和必填编辑基线，不接受额外版本机制', () => {
    expect(restoreRevisionSchema.parse({ revisionId: 4, expectedRevisionId: 7 }))
      .toEqual({ revisionId: 4, expectedRevisionId: 7 })
    for (const input of [
      { revisionId: 4 },
      { revisionId: 4, expectedRevisionId: null },
      { revisionId: 4, expectedRevisionId: 0 },
      { revisionId: 4, expectedRevisionId: 7, version: 'extra' },
    ]) expect(restoreRevisionSchema.safeParse(input).success).toBe(false)
  })

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
