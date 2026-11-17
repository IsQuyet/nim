import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import { parseMarkdownFile, serializeMarkdownFile } from './file-format'

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const content = { title: '  标题："原文"  ', description: '第一行\n第二行', body: '# 正文\r\n' }

function parsed(source: string) {
  const result = parseMarkdownFile(source)
  assert.ok(result.success)
  return result.data
}

describe('Markdown 文件交换格式', () => {
  it.each([
    '',
    '\n\n',
    '    first-line code\r\n\n',
    '# 中文正文\r\n\r\n末尾空白  \r\n',
    '---\ntitle: body, not metadata\n---\n',
    'No final newline',
  ])('导出再导入保留标题、摘要与完整正文 %#', body => {
    const document = { ...content, id, body }
    const exported = serializeMarkdownFile(document)
    const restored = parsed(exported)
    expect(restored).toEqual(document)
    assert.ok(restored.id)
    expect(serializeMarkdownFile({ ...restored, id: restored.id })).toBe(exported)
  })

  it('无 ID 的文档保留新建语义，格式标识与摘要缺省值有明确定义', () => {
    expect(parsed('---\ntitle: New post\n---\n# Body\n')).toEqual({
      title: 'New post', description: '', body: '# Body\n',
    })
  })

  it('支持 UTF-8 标记与 CRLF 文件头，不改变正文换行', () => {
    const source = `${String.fromCharCode(0xFEFF)}---\r\nid: ${id}\r\ntitle: Title\r\n---\r\n\r\n    code\r\n`
    expect(parsed(source)).toEqual({ id, title: 'Title', description: '', body: '\r\n    code\r\n' })
  })

  it.each([id, '019496d5-2f8a-7b35-8c34-123456789abc', id.toUpperCase()])(
    '接受不同版本的合法 UUID，并保留输入身份 %s', postId => {
      expect(parsed(`---\nid: ${postId}\ntitle: Title\n---\n`).id).toBe(postId)
    },
  )

  it('只在文件换行边界识别分隔符，不把标题内的 Unicode 分隔字符当作文件头结尾', () => {
    const source = `---\ntitle: "Text${String.fromCharCode(0x2028)}---\n  continued"\n---\n# Body\n`
    expect(parsed(source).body).toBe('# Body\n')
  })

  it('保留 YAML 块标量声明的尾换行，不把元数据末尾换行当作分隔符的一部分', () => {
    const source = '---\ntitle: Title\ndescription: |+\n  Line\n\n---\n# Body\n'
    expect(parsed(source)).toEqual({ title: 'Title', description: 'Line\n\n', body: '# Body\n' })
  })

  it('限制 YAML 别名展开，不把元数据解析错误传成内容', () => {
    const aliases = Array.from({ length: 101 }, () => '*title').join(', ')
    const result = parseMarkdownFile(`---\ntitle: &title Title\ndescription: [${aliases}]\n---\n`)
    expect(result).toEqual({ success: false, message: 'The YAML front matter is invalid.' })
  })

  it('文件只携带内容与文章身份，不导出数据库修订或发布状态', () => {
    const input = { ...content, id, revisionId: 123, publicationId: 456, createdAt: '2026-11-01', source: 'restore' }
    const exported = serializeMarkdownFile(input)
    expect(exported).not.toContain('revisionId')
    expect(exported).not.toContain('publicationId')
    expect(exported).not.toContain('createdAt')
    expect(parsed(exported)).toEqual({ ...content, id })
  })

  it.each([
    '# No metadata',
    '---\ntitle: Missing closing delimiter',
    '---\n---\n',
    '---\ntitle: \n---\n',
    '---\ntitle: 123\n---\n',
    '---\ntitle: "   "\n---\n',
    '---\ntitle: Title\ndescription: false\n---\n',
    '---\ntitle: Title\nid: not-an-id\n---\n',
    '---\ntitle: Title\nformat: nim-post/v2\n---\n',
    '---\ntitle: Title\ntags: [unknown]\n---\n',
    '---\ntitle: First\ntitle: Second\n---\n',
    '---\ntitle: [unterminated\n---\n',
    '---js\n({ title: "JavaScript is not metadata" })\n---\n',
    '---\ntitle: !!js/function "function () {}"\n---\n',
  ])('拒绝无效格式、歧义字段和可执行元数据标记 %#', source => {
    const result = parseMarkdownFile(source)
    expect(result.success).toBe(false)
    assert.ok(!result.success)
    expect(result.message.length).toBeGreaterThan(0)
  })
})
