import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { routes } from '@/lib/routes'
import { getGalleryItem } from '@/modules/gallery/server/public'
import { GalleryActions } from '@/modules/gallery/ui/gallery-actions'

type GalleryItemPageProps = {
  params: Promise<{ id: string }>
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
})

export async function generateMetadata({
  params,
}: GalleryItemPageProps): Promise<Metadata> {
  const { id } = await params
  const item = await getGalleryItem(id)
  if (!item) notFound()

  return {
    title: item.title,
    description: item.caption || undefined,
    alternates: { canonical: routes.galleryItem(item.id) },
    openGraph: {
      images: [routes.media(item.mediaId)],
    },
  }
}

export default async function GalleryItemPage({ params }: GalleryItemPageProps) {
  const { id } = await params
  const item = await getGalleryItem(id)
  if (!item) notFound()

  const metadataParts = [
    item.location || null,
    item.takenAt ? `Taken ${dateFormatter.format(new Date(`${item.takenAt}T00:00:00Z`))}` : null,
    `Published ${dateFormatter.format(new Date(item.publishedAt))}`,
    `${item.media.width}×${item.media.height}`,
  ].filter(Boolean)

  return (
    <Canvas>
      <main className="space-y-8">
        <PageHeader
          title={item.title}
          back={{ href: routes.gallery, label: 'Back to gallery' }}
          description={item.caption ? <p>{item.caption}</p> : undefined}
          actions={<GalleryActions />}
        />

        <figure className="space-y-4">
          <div className="flex justify-center overflow-hidden rounded-2xl border bg-muted/40 p-2 sm:p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={routes.media(item.mediaId)}
              alt={item.title}
              width={item.media.width}
              height={item.media.height}
              className="max-h-[75vh] w-auto max-w-full rounded-xl object-contain"
            />
          </div>
          <figcaption className="text-sm text-muted-foreground">
            {metadataParts.join(' · ')}
          </figcaption>
        </figure>
      </main>
    </Canvas>
  )
}
