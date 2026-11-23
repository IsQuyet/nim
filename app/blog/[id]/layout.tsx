'use client'
import { TextMorph } from '@/components/ui/text-morph'
import { ScrollProgress } from '@/components/ui/scroll-progress'
import { useEffect, useState } from 'react'
import { MarkdownProse } from '@/modules/markdown/ui/prose'
import { Focus } from '@/components/layout/focus'

function CopyButton() {
  const [text, setText] = useState('Copy')

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setText('Copy')
    }, 2000)

    return () => window.clearTimeout(timeout)
  }, [text])

  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href)
        setText('Copied')
      }}
      className="flex items-center gap-1 text-center text-sm text-muted-foreground transition-colors"
      type="button"
    >
      <TextMorph>{text}</TextMorph>
      <span>URL</span>
    </button>
  )
}

export default function LayoutBlogPost({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <ScrollProgress
        className="fixed top-0 z-50 h-0.5 bg-foreground/30"
        springOptions={{
          bounce: 0,
        }}
      />

      <Focus>
        <div className="mb-6 flex justify-end">
          <CopyButton />
        </div>
        <MarkdownProse as="main">{children}</MarkdownProse>
      </Focus>
    </>
  )
}
