'use client'

import { MarkdownHooks } from 'react-markdown'
import { markdownRenderOptions } from './markdown-renderer-options'

type MarkdownPreviewProps = {
  source: string
}

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <MarkdownHooks
      {...markdownRenderOptions}
      fallback={<p role="status">Rendering preview…</p>}
    >
      {source}
    </MarkdownHooks>
  )
}
