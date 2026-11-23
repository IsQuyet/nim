import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminDraft } from '@/modules/posts/server/admin'
import { PostEditor } from '@/modules/posts/ui/post-editor'
import { routes } from '@/lib/routes'

export const metadata: Metadata = { title: 'Edit draft' }

type EditDraftPageProps = {
  params: Promise<{ id: string }>
}

export default async function EditDraftPage({ params }: EditDraftPageProps) {
  const { id } = await params
  const draft = await getAdminDraft(id)
  if (!draft) notFound()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href={routes.admin.home} className="underline underline-offset-4">
            Back to posts
          </Link>
        </div>
        <h1 className="text-lg font-medium">Edit draft</h1>
        <p className="text-xs break-all text-muted-foreground">
          /blog/{draft.id}
        </p>
      </section>
      <PostEditor key={draft.id} postId={draft.id} initial={draft} />
    </main>
  )
}
