import Link from 'next/link'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { getAdminPosts } from '@/modules/posts/server/admin'
import type { PostSummary } from '@/modules/posts/model'
import { routes } from '@/lib/routes'

const STATUS_LABELS = {
  draft: 'Draft',
  published: 'Published',
  modified: 'Unpublished changes',
} satisfies Record<PostSummary['status'], string>

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export default async function AdminPage() {
  const posts = await getAdminPosts()

  return (
    <Canvas>
      <main>
        <PageHeader
          title="Admin"
          description={<p>Drafts and published posts.</p>}
          actions={
            <>
              <Button asChild variant="default">
                <Link href={routes.admin.newPost}>New draft</Link>
              </Button>
              <Button asChild>
                <Link href={routes.admin.import}>Import Markdown</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.admin.gallery}>Gallery</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.admin.homepage}>Homepage</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={routes.admin.media}>Media library</Link>
              </Button>
            </>
          }
        />
        {posts.length > 0 ? (
          <ul aria-label="Posts" className="divide-y divide-border border-y">
            {posts.map(post => (
              <li key={post.id} className="canvas-grid gap-y-2 py-5">
                <div className="col-span-full space-y-1 md:col-span-8">
                  <h2 className="font-medium">
                    <Link href={routes.admin.post(post.id)} className="transition-colors hover:text-muted-foreground">
                      {post.title}
                    </Link>
                  </h2>
                  {post.description && (
                    <p className="text-muted-foreground">{post.description}</p>
                  )}
                  <p className="text-xs break-all text-muted-foreground">/blog/{post.id}</p>
                </div>
                <div className="col-span-full flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground md:col-span-4 md:flex-col md:items-end md:text-right">
                  <span className={post.status === 'published' ? undefined : 'text-foreground'}>
                    {STATUS_LABELS[post.status]}
                  </span>
                  <time dateTime={post.updatedAt}>
                    Updated {dateFormatter.format(new Date(post.updatedAt))}
                  </time>
                  {post.status !== 'draft' && (
                    <Link
                      href={routes.post(post.id)}
                      className="underline underline-offset-4 transition-colors hover:text-foreground"
                    >
                      View published
                    </Link>
                  )}
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
