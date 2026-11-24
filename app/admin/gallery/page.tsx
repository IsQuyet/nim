import type { Metadata } from 'next'
import Link from 'next/link'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'
import { getAdminGallery } from '@/modules/gallery/server/admin'
import { GalleryAdmin } from '@/modules/gallery/ui/gallery-admin'

export const metadata: Metadata = { title: 'Gallery' }

export default async function AdminGalleryPage() {
  const { items, assets } = await getAdminGallery()

  return (
    <Canvas>
      <main>
        <PageHeader
          title="Gallery"
          back={{ href: routes.admin.home, label: 'Back to posts' }}
          description={<p>Manage photos published to the gallery and their captions.</p>}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={routes.admin.homepage}>Homepage</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.admin.media}>Media library</Link>
              </Button>
            </>
          }
        />
        <GalleryAdmin items={items} assets={assets} />
      </main>
    </Canvas>
  )
}
