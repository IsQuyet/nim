import { getBlogPosts } from '@/modules/posts/server/public'
import { Canvas } from '@/components/layout/canvas'
import { HomeContent } from '@/modules/site/ui/home-content'

export default async function HomePage() {
  const posts = await getBlogPosts()

  return (
    <Canvas>
      <HomeContent posts={posts} />
    </Canvas>
  )
}
