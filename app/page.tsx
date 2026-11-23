import { getBlogPosts } from '@/modules/posts/server/public'
import { Focus } from '@/components/layout/focus'
import { HomeContent } from '@/modules/site/ui/home-content'

export default async function HomePage() {
  const posts = await getBlogPosts()

  return (
    <Focus>
      <HomeContent posts={posts} />
    </Focus>
  )
}
