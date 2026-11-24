import type { Metadata } from 'next'
import Link from 'next/link'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'
import { getAdminHomepageData } from '@/modules/site/server/home'
import { HomeAdmin } from '@/modules/site/ui/home-admin'

export const metadata: Metadata = { title: 'Homepage' }

export default async function AdminHomepagePage() {
  const initial = await getAdminHomepageData()

  return (
    <Canvas>
      <main>
        <PageHeader
          title="Homepage"
          back={{ href: routes.admin.home, label: 'Back to posts' }}
          description={<p>Control homepage sections, order, selection mode, and individual featured entries.</p>}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={routes.admin.gallery}>Gallery</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.admin.media}>Media library</Link>
              </Button>
            </>
          }
        />
        <HomeAdmin initial={initial} />
      </main>
    </Canvas>
  )
}
