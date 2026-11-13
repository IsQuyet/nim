import Link from 'next/link'
import { getAdminPosts } from '@/lib/admin-posts'
import type { PostSummary } from '@/lib/posts'
import { AuthButton } from './auth-button'

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
          <p className="text-zinc-600 dark:text-zinc-400">
            Drafts and published posts.
          </p>
        </section>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/posts/new"
            className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors hover:bg-zinc-950 hover:text-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            New draft
          </Link>
          <AuthButton action="sign-out" />
        </div>
      </div>
      {posts.length > 0 ? (
        <ul aria-label="Posts" className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {posts.map(post => (
            <li key={post.id} className="space-y-2 py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-medium dark:text-zinc-100">
                  <Link href={`/admin/posts/${post.id}`} className="transition-colors hover:text-zinc-600 dark:hover:text-zinc-400">
                    {post.title}
                  </Link>
                </h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {STATUS_LABELS[post.status]}
                </span>
              </div>
              {post.description && (
                <p className="text-zinc-600 dark:text-zinc-400">{post.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="break-all">/blog/{post.id}</span>
                <time dateTime={post.updatedAt}>
                  Updated {dateFormatter.format(new Date(post.updatedAt))}
                </time>
                {post.status !== 'draft' && (
                  <Link
                    href={`/blog/${post.id}`}
                    className="underline underline-offset-4 transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
                  >
                    View published
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-zinc-500 dark:text-zinc-400">No posts yet.</p>
      )}
    </main>
  )
}
