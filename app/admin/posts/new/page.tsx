import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireAdminSession } from '@/modules/auth/server/auth'
import { getAdminDraft } from '@/modules/posts/server/admin'
import { postIdSchema } from '@/modules/posts/model'
import { PostEditor } from '@/modules/posts/ui/post-editor'
import { routes } from '@/lib/routes'

export const metadata: Metadata = { title: 'New draft' }

export default async function NewDraftPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminSession()
  const identity = postIdSchema.optional().safeParse((await searchParams).draft)
  if (!identity.success) notFound()
  if (!identity.data) redirect(routes.admin.newDraft(randomUUID()))
  const id = identity.data
  const initial = await getAdminDraft(id)

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <Link
          href={routes.admin.home}
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to posts
        </Link>
        <h1 className="text-lg font-medium">New draft</h1>
        <p className="text-muted-foreground">
          Write in Markdown and save a draft.
        </p>
      </section>
      <PostEditor key={id} postId={id} initial={initial} />
    </main>
  )
}
