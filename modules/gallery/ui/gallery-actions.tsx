'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { LinkIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextMorph } from '@/components/ui/text-morph'
import { routes } from '@/lib/routes'
import { authClient } from '@/modules/auth/client'

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

/** 单张画廊作品的分享与后台跳转操作。 */
export function GalleryActions() {
  const session = authClient.useSession()

  return (
    <div className="flex flex-wrap items-center gap-4">
      <CopyLink />
      {session.data && (
        <Button asChild variant="quiet" size="text">
          <Link href={routes.admin.gallery}>
            <PencilIcon />
            Manage gallery
          </Link>
        </Button>
      )}
    </div>
  )
}
