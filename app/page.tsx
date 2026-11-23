import { getBlogPosts } from '@/modules/posts/server/public'
import { HomeContent } from '@/modules/site/ui/home-content'

export default async function HomePage() {
  const posts = await getBlogPosts()

  return <HomeContent posts={posts} />
}
