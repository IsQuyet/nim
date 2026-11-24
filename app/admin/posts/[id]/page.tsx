import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
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
    <Canvas>
      <main>
        <PageHeader
          title="Edit draft"
          back={{ href: routes.admin.home, label: 'Back to posts' }}
          description={<p className="text-xs break-all">/blog/{draft.id}</p>}
        />
        <PostEditor key={draft.id} postId={draft.id} initial={draft} />
      </main>
    </Canvas>
  )
}
