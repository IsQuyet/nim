import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminWorkingCopy } from '@/lib/admin-posts'
import { PostEditor } from '../../post-editor'

export const metadata: Metadata = { title: 'Edit draft' }

type EditDraftPageProps = {
  params: Promise<{ id: string }>
}

export default async function EditDraftPage({ params }: EditDraftPageProps) {
  const { id } = await params
  const draft = await getAdminWorkingCopy(id)
  if (!draft) notFound()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap gap-4 text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/admin" className="underline underline-offset-4">
            Back to posts
          </Link>
        </div>
        <h1 className="text-lg font-medium">Edit draft</h1>
        <p className="text-xs break-all text-zinc-500 dark:text-zinc-400">
          /blog/{draft.id}
        </p>
      </section>
      <PostEditor key={draft.id} postId={draft.id} initial={draft} />
    </main>
  )
}
