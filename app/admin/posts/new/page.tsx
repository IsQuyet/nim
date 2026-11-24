import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
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
    <Canvas>
      <main>
        <PageHeader
          title="New draft"
          back={{ href: routes.admin.home, label: 'Back to posts' }}
          description={<p>Write in Markdown and save a draft.</p>}
        />
        <PostEditor key={id} postId={id} initial={initial} />
      </main>
    </Canvas>
  )
}
