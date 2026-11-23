import Link from 'next/link'
import { getAdminPosts } from '@/modules/posts/server/admin'
import type { PostSummary } from '@/modules/posts/model'
import { AuthButton } from '@/modules/auth/ui/auth-button'
import { Button } from '@/components/ui/button'

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
    <main className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <section className="space-y-3">
          <h1 className="text-lg font-medium">Admin</h1>
          <p className="text-muted-foreground">
            Drafts and published posts.
          </p>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild>
            <Link href="/admin/posts/new">New draft</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/import">Import Markdown</Link>
          </Button>
          <AuthButton action="sign-out" />
        </div>
      </div>
      {posts.length > 0 ? (
        <ul aria-label="Posts" className="divide-y divide-border">
          {posts.map(post => (
            <li key={post.id} className="space-y-2 py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-medium">
                  <Link href={`/admin/posts/${post.id}`} className="transition-colors hover:text-muted-foreground">
                    {post.title}
                  </Link>
                </h2>
                <span className="text-xs text-muted-foreground">
                  {STATUS_LABELS[post.status]}
                </span>
              </div>
              {post.description && (
                <p className="text-muted-foreground">{post.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="break-all">/blog/{post.id}</span>
                <time dateTime={post.updatedAt}>
                  Updated {dateFormatter.format(new Date(post.updatedAt))}
                </time>
                {post.status !== 'draft' && (
                  <Link
                    href={`/blog/${post.id}`}
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
  )
}
