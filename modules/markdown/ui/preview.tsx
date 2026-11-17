'use client'

import { memo } from 'react'
import { MarkdownHooks } from 'react-markdown'
import { markdownRenderOptions } from '../render-options'

type MarkdownPreviewProps = {
  source: string
}

// 正文不变时跳过整棵预览树的重建，外层因其他状态重新渲染不会波及这里。
export const MarkdownPreview = memo(function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <MarkdownHooks
      {...markdownRenderOptions}
      fallback={<p role="status">Rendering preview…</p>}
    >
      {source}
    </MarkdownHooks>
  )
})
