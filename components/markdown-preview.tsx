'use client'

import { memo, useEffect, useState } from 'react'
import { MarkdownHooks } from 'react-markdown'
import { markdownRenderOptions } from './markdown-renderer-options'

type MarkdownPreviewProps = {
  source: string
}

// 解析和高亮整篇正文会占用主线程，连续输入期间不逐次重算，停顿后再更新。
const SETTLE_DELAY_MS = 200

function useSettled(value: string) {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === settled) return
    const timer = setTimeout(() => setSettled(value), SETTLE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [value, settled])

  return settled
}

// 正文不变时跳过整棵预览树的重建，外层因其他状态重新渲染不会波及这里。
const RenderedMarkdown = memo(function RenderedMarkdown({ source }: MarkdownPreviewProps) {
  return (
    <MarkdownHooks
      {...markdownRenderOptions}
      fallback={<p role="status">Rendering preview…</p>}
    >
      {source}
    </MarkdownHooks>
  )
})

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return <RenderedMarkdown source={useSettled(source)} />
}
