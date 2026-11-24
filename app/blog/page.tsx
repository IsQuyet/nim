import type { Metadata } from 'next'
import Link from 'next/link'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { getBlogPosts } from '@/modules/posts/server/public'
import { routes } from '@/lib/routes'

export const metadata: Metadata = {
  title: 'Blog',
  alternates: { canonical: routes.blog },
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export default async function BlogIndexPage() {
  const posts = await getBlogPosts()

  return (
    <Canvas>
      <main>
        <PageHeader title="Blog" />
        {posts.length > 0 ? (
          <ul aria-label="Posts" className="divide-y divide-border border-y">
            {posts.map(post => (
              <li key={post.id} className="canvas-grid gap-y-1 py-5">
                <time dateTime={post.publishedAt} className="col-span-full text-sm text-muted-foreground md:col-span-2 md:pt-0.5">
                  {dateFormatter.format(new Date(post.publishedAt))}
                </time>
                <div className="col-span-full space-y-1 md:col-span-8">
                  <h2 className="font-medium">
                    <Link href={routes.post(post.id)} className="transition-colors hover:text-muted-foreground">
                      {post.title}
                    </Link>
                  </h2>
                  {post.description && <p className="text-muted-foreground">{post.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No posts yet.</p>
        )}
      </main>
    </Canvas>
  )
}
