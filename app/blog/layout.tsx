'use client'
import { TextMorph } from '@/components/ui/text-morph'
import { ScrollProgress } from '@/components/ui/scroll-progress'
import { useEffect, useState } from 'react'
import { MarkdownProse } from '@/modules/markdown/ui/prose'

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
      className="flex items-center gap-1 text-center text-sm text-zinc-500 transition-colors dark:text-zinc-400"
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
      <div className="pointer-events-none fixed left-0 top-0 z-10 h-12 w-full bg-gray-100 to-transparent backdrop-blur-xl [-webkit-mask-image:linear-gradient(to_bottom,black,transparent)] dark:bg-zinc-950" />
      <ScrollProgress
        className="fixed top-0 z-20 h-0.5 bg-gray-300 dark:bg-zinc-600"
        springOptions={{
          bounce: 0,
        }}
      />

      <div className="absolute right-4 top-24">
        <CopyButton />
      </div>
      <MarkdownProse as="main" className="mt-24 pb-20">
        {children}
      </MarkdownProse>
    </>
  )
}
