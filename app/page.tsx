import { Canvas } from '@/components/layout/canvas'
import { getHomepageData } from '@/modules/site/server/home'
import { HomeContent } from '@/modules/site/ui/home-content'

export default async function HomePage() {
  const data = await getHomepageData()

  return (
    <Canvas>
      <HomeContent data={data} />
    </Canvas>
  )
}
