import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { visit } from 'unist-util-visit'
import { markdownRemarkPlugins, markdownRehypeOptions } from './markdown-syntax'
import { postIdSchema } from './content'

const parser = unified().use(remarkParse).use(markdownRemarkPlugins).use(remarkRehype, markdownRehypeOptions)

type MediaReferenceResult =
  | { status: 'success'; ids: string[] }
  | { status: 'invalid'; message: string }

function mediaIdFromUrl(url: string) {
  if (!/^\/(?![\\/])/u.test(url)) return { status: 'success' as const, id: null }
  let resolved: URL
  try {
    resolved = new URL(url, 'https://nim.invalid')
  } catch {
    return { status: 'success' as const, id: null }
  }
  if (resolved.origin !== 'https://nim.invalid' || !resolved.pathname.startsWith('/media/')) {
    return { status: 'success' as const, id: null }
  }
  let candidate: string
  try {
    candidate = decodeURIComponent(resolved.pathname.slice('/media/'.length))
  } catch {
    return { status: 'invalid' as const, message: 'A Markdown media URL must contain a valid media UUID.' }
  }
  const id = postIdSchema.safeParse(candidate)
  return id.success
    ? { status: 'success' as const, id: id.data }
    : { status: 'invalid' as const, message: 'A Markdown media URL must contain a valid media UUID.' }
}

export function extractMediaReferences(source: string): MediaReferenceResult {
  // 发布授权来自实际生成的图片，引用定义、脚注和 alt 的可见性由正文转换器统一决定。
  const tree = parser.runSync(parser.parse(source))
  const urls: string[] = []
  visit(tree, 'element', node => {
    if (node.tagName === 'img' && typeof node.properties.src === 'string') urls.push(node.properties.src)
  })
  const ids = new Set<string>()
  for (const url of urls) {
    const reference = mediaIdFromUrl(url)
    if (reference.status === 'invalid') return reference
    if (reference.id) ids.add(reference.id)
  }
  return { status: 'success', ids: [...ids].sort() }
}
