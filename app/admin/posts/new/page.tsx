import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAdminSession } from '@/lib/auth'
import { getAdminDraft } from '@/lib/admin-posts'
import { postIdSchema } from '@/lib/content'
import { PostEditor } from '../../post-editor'

export const metadata: Metadata = { title: 'New draft' }

export default async function NewDraftPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminSession()
  const identity = postIdSchema.optional().safeParse((await searchParams).draft)
  if (!identity.success) notFound()
  if (!identity.data) redirect(`/admin/posts/new?draft=${randomUUID()}`)
  const id = identity.data
  const initial = await getAdminDraft(id)

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
      <PostEditor key={id} postId={id} initial={initial} />
    </main>
  )
}
