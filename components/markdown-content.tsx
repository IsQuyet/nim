import 'server-only'
import { MarkdownAsync } from 'react-markdown'
import { markdownRenderOptions } from './markdown-renderer-options'

type MarkdownContentProps = {
  source: string
}

export async function MarkdownContent({ source }: MarkdownContentProps) {
  return MarkdownAsync({ ...markdownRenderOptions, children: source })
}
