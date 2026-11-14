import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminSession } from '@/lib/auth'
import { createDraftAction } from '../../actions'
import { PostEditor } from '../../post-editor'

export const metadata: Metadata = { title: 'New draft' }

export default async function NewDraftPage() {
  await requireAdminSession()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <Link
          href="/admin"
          className="text-sm text-zinc-500 underline underline-offset-4 dark:text-zinc-400"
        >
          Back to posts
        </Link>
        <h1 className="text-lg font-medium">New draft</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Write in Markdown and save a draft.
        </p>
      </section>
      <PostEditor
        initialContent={{ title: '', description: '', body: '' }}
        initialRevisionId={null}
        creationId={randomUUID()}
        action={createDraftAction}
      />
    </main>
  )
}
