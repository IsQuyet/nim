import type { Metadata } from 'next'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { routes } from '@/lib/routes'
import { getGalleryItems } from '@/modules/gallery/server/public'
import { GalleryGrid } from '@/modules/gallery/ui/gallery-grid'

export const metadata: Metadata = {
  title: 'Gallery',
  alternates: { canonical: routes.gallery },
}

export default async function GalleryIndexPage() {
  const items = await getGalleryItems()

  return (
    <Canvas>
      <main>
        <PageHeader title="Gallery" />
        <GalleryGrid items={items} variant="archive" />
      </main>
    </Canvas>
  )
}
