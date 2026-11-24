import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import { visit } from 'unist-util-visit'
import type { Element, Root, RootContent } from 'hast'
import { markdownRemarkPlugins, markdownRehypeOptions } from './syntax'

export type MarkdownHeading = {
  id: string
  text: string
  depth: 2 | 3
}

const headingProcessor = unified()
  .use(remarkParse)
  .use(markdownRemarkPlugins)
  .use(remarkRehype, markdownRehypeOptions)
  .use(rehypeSlug)

function textOf(node: RootContent): string {
  if (node.type === 'text') return node.value
  if ('children' in node) return node.children.map(textOf).join('')
  return ''
}

function headingDepth(node: Element): 2 | 3 | null {
  if (node.tagName === 'h2') return 2
  if (node.tagName === 'h3') return 3
  return null
}

/**
 * 从 Markdown 正文提取目录使用的二级与三级标题。
 * 通过与正文渲染相同的 remark/rehype + rehype-slug 流水线生成 id，确保锚点完全一致。
 */
export function extractMarkdownHeadings(source: string): MarkdownHeading[] {
  const tree = headingProcessor.runSync(headingProcessor.parse(source)) as Root
  const headings: MarkdownHeading[] = []

  visit(tree, 'element', node => {
    // 跳过无源码位置的合成标题（例如 GFM 自动生成的 Footnotes 标题）。
    if (node.position === undefined) return
    const depth = headingDepth(node)
    if (depth === null) return

    const id = typeof node.properties?.id === 'string' ? node.properties.id : ''
    const text = node.children.map(textOf).join('').trim()
    if (!id || !text) return

    headings.push({ id, text, depth })
  })

  return headings
}
