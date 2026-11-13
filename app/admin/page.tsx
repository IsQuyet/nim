import Link from 'next/link'
import { requireAdminSession } from '@/lib/auth'
import { openDatabase } from '@/lib/database'
import { createPostStore, type PostSummary } from '@/lib/posts'
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
  await requireAdminSession()
  const database = openDatabase()
  let posts: PostSummary[]

  try {
    posts = createPostStore(database).listPosts()
  } finally {
    database.close()
  }

  return (
    <main className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <section className="space-y-3">
          <h1 className="text-lg font-medium">Admin</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Drafts and published posts.
          </p>
        </section>
        <AuthButton action="sign-out" />
      </div>
      {posts.length > 0 ? (
        <ul aria-label="Posts" className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {posts.map(post => (
            <li key={post.id} className="space-y-2 py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="font-medium dark:text-zinc-100">{post.title}</h2>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {STATUS_LABELS[post.status]}
                </span>
              </div>
              {post.description && (
                <p className="text-zinc-600 dark:text-zinc-400">{post.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="break-all">/blog/{post.slug}</span>
                <time dateTime={post.updatedAt}>
                  Updated {dateFormatter.format(new Date(post.updatedAt))}
                </time>
                {post.status !== 'draft' && (
                  <Link
                    href={`/blog/${post.slug}`}
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
