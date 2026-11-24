import type { Metadata } from 'next'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { routes } from '@/lib/routes'
import { getAdminMedia } from '@/modules/posts/server/admin'
import { MediaLibrary } from '@/modules/posts/ui/media-library'

export const metadata: Metadata = { title: 'Media' }

export default async function AdminMediaPage() {
  const items = await getAdminMedia()

  return (
    <Canvas>
      <main>
        <PageHeader
          title="Media"
          back={{ href: routes.admin.home, label: 'Back to posts' }}
          description={<p>Uploaded images and where they are referenced across drafts and published posts.</p>}
        />
        <MediaLibrary items={items} />
      </main>
    </Canvas>
  )
}
