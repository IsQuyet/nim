import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import { extractMediaReferences } from './references'

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

function renderedMediaIds(source: string) {
  const markup = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm], skipHtml: true }, source))
  const document = new DOMParser().parseFromString(markup, 'text/html')
  const ids: string[] = []
  for (const image of document.querySelectorAll('img')) {
    const url = new URL(image.getAttribute('src') ?? '', 'https://nim.invalid')
    const match = /^\/media\/([0-9a-f-]+)$/u.exec(decodeURIComponent(url.pathname))
    if (url.origin === 'https://nim.invalid' && match) ids.push(match[1])
  }
  return [...new Set(ids)].sort()
}

const scenarios = [
  { name: '未引用的脚注不渲染图片', source: `Text only\n\n[^unused]: ![private](/media/${id})` },
  { name: '已引用的脚注渲染图片', source: `Text[^used]\n\n[^used]: ![visible](/media/${id})` },
  { name: '脚注递归引用仅渲染可达部分', source: `Text[^a]\n\n[^a]: Nested[^b]\n\n[^b]: ![visible](/media/${id})` },
  { name: '根相对 URL 的当前路径段', source: `![visible](/./media/${id})` },
  { name: '根相对 URL 的父路径段', source: `![visible](/assets/../media/${id})` },
  { name: '百分号编码的路径段', source: `![visible](/%2e/media/${id})` },
  { name: '携带查询和片段的媒体 URL', source: `![visible](/media/${id}?v=1#image)` },
  { name: '外部 protocol-relative URL', source: `![remote](//example.test/media/${id})` },
  { name: '直接图片', source: `![visible](/media/${id})` },
  { name: '完整引用图片', source: `![visible][p]\n\n[p]: /media/${id}` },
  { name: '折叠引用图片', source: `![p][]\n\n[p]: /media/${id}` },
  { name: '简写引用图片', source: `![p]\n\n[p]: /media/${id}` },
  { name: '引用定义中的尖括号 URL', source: `![visible][p]\n\n[p]: </media/${id}>` },
  { name: 'URL 转义', source: `![visible](\\/media/${id})` },
  { name: 'URL 字符引用', source: `![visible](/med&#105;a/${id})` },
  { name: '定义按首次出现确定', source: `![visible][p]\n\n[p]: /media/${id}\n[p]: https://example.test/remote.png` },
  { name: '不同转义引用标签', source: `![visible][x*]\n\n[x\\*]: /media/${id}\n[x*]: https://example.test/remote.png` },
  { name: '图片 alt 中的内层语法', source: `![outer ![private](/media/${id})](https://example.test/remote.png)` },
  { name: '代码与 HTML 中不渲染的图片', source: `\`![hidden](/media/${id})\`\n\n\`\`\`md\n![hidden](/media/${id})\n\`\`\`\n\n<img src="/media/${id}">` },
]

describe('媒体发布引用与公开 Markdown 的同源语义', () => {
  it.each(scenarios)('$name 只登记实际渲染的本机图片', ({ source }) => {
    expect(extractMediaReferences(source)).toEqual({ status: 'success', ids: renderedMediaIds(source) })
  })

  it('多处实际图片引用去重，外部图片不纳入本机发布授权', () => {
    const source = `![a](/media/${id})\n\n![b](/media/${id})\n\n![remote](https://example.test/remote.png)`
    expect(extractMediaReferences(source)).toEqual({ status: 'success', ids: [id] })
  })

  it('protocol-relative 外站图片即使与解析占位主机同名，也不授权本机媒体', () => {
    expect(extractMediaReferences(`![remote](//nim.invalid/media/${id})`)).toEqual({ status: 'success', ids: [] })
  })

  it('拒绝保留媒体路由中的无效身份', () => {
    expect(extractMediaReferences('![missing](/media/not-a-uuid)')).toMatchObject({ status: 'invalid' })
  })
})
