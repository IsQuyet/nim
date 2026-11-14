import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminDraft } from '@/lib/admin-posts'
import { saveDraftAction } from '../../actions'
import { PostEditor } from '../../post-editor'

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
        <Link
          href="/admin"
          className="text-sm text-zinc-500 underline underline-offset-4 dark:text-zinc-400"
        >
          Back to posts
        </Link>
        <h1 className="text-lg font-medium">Edit draft</h1>
        <p className="text-xs break-all text-zinc-500 dark:text-zinc-400">
          /blog/{draft.id}
        </p>
      </section>
      <PostEditor
        key={draft.id}
        initialContent={{
          title: draft.title,
          description: draft.description,
          body: draft.body,
        }}
        initialRevisionId={draft.revisionId}
        action={saveDraftAction.bind(null, draft.id)}
      />
    </main>
  )
}
