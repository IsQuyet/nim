import 'server-only'
import type { ReactElement } from 'react'
import { MarkdownAsync } from 'react-markdown'
import { markdownRenderOptions } from './markdown-renderer-options'

type MarkdownContentProps = {
  source: string
}

/** 渲染结果占用的内存与正文长度成正比，按已保留正文的总字符数设上限。 */
export const MAX_CACHED_CHARACTERS = 256 * 1024

const rendered = new Map<string, Promise<ReactElement>>()
let cachedCharacters = 0

function forget(source: string, result: Promise<ReactElement>) {
  if (rendered.get(source) !== result) return
  rendered.delete(source)
  cachedCharacters -= source.length
}

/** 渲染结果只由正文决定，相同正文复用同一次解析与高亮的结果。 */
export function renderMarkdown(source: string): Promise<ReactElement> {
  const cached = rendered.get(source)
  if (cached) {
    // Map 按插入顺序迭代，重新插入后它最晚被淘汰。
    rendered.delete(source)
    rendered.set(source, cached)
    return cached
  }

  const result = MarkdownAsync({ ...markdownRenderOptions, children: source })
  if (source.length > MAX_CACHED_CHARACTERS) return result

  rendered.set(source, result)
  cachedCharacters += source.length
  // 失败可能来自语言包加载等暂时原因，不保留，下次重新渲染。
  result.catch(() => forget(source, result))
  for (const [oldest, oldestResult] of rendered) {
    if (cachedCharacters <= MAX_CACHED_CHARACTERS) break
    forget(oldest, oldestResult)
  }
  return result
}

export async function MarkdownContent({ source }: MarkdownContentProps) {
  return renderMarkdown(source)
}
