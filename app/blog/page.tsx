import type { Metadata } from 'next'
import Link from 'next/link'
import { getBlogPosts } from '@/modules/posts/server/public'
import { routes } from '@/lib/routes'
import { Focus } from '@/components/layout/focus'

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
    <Focus>
      <main className="space-y-8">
        <h1 className="text-lg font-medium">Blog</h1>
        {posts.length > 0 ? (
          <ul aria-label="Posts" className="divide-y divide-border">
            {posts.map(post => (
              <li key={post.id} className="space-y-1 py-5 first:pt-0 last:pb-0">
                <h2 className="font-medium">
                  <Link href={routes.post(post.id)} className="transition-colors hover:text-muted-foreground">
                    {post.title}
                  </Link>
                </h2>
                {post.description && <p className="text-muted-foreground">{post.description}</p>}
                <time dateTime={post.publishedAt} className="block text-xs text-muted-foreground">
                  {dateFormatter.format(new Date(post.publishedAt))}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No posts yet.</p>
        )}
      </main>
    </Focus>
  )
}
