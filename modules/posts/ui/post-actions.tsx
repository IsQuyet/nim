'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LinkIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextMorph } from '@/components/ui/text-morph'
import { authClient } from '@/modules/auth/client'
import { routes } from '@/lib/routes'

function CopyLink() {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return (
    <Button
      type="button"
      variant="quiet"
      size="text"
      onClick={async () => {
        await navigator.clipboard.writeText(window.location.href)
        setCopied(true)
      }}
    >
      <LinkIcon />
      <TextMorph>{copied ? 'Copied link' : 'Copy link'}</TextMorph>
    </Button>
  )
}

/** 针对当前文章的操作。编辑入口只在已登录管理员的浏览器里出现。 */
export function PostActions({ postId }: { postId: string }) {
  const session = authClient.useSession()

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 md:flex-col md:items-start">
      <CopyLink />
      {session.data && (
        <Button asChild variant="quiet" size="text">
          <Link href={routes.admin.post(postId)}>
            <PencilIcon />
            Edit this post
          </Link>
        </Button>
      )}
    </div>
  )
}
