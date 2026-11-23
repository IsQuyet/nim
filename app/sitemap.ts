import type { MetadataRoute } from 'next'
import { getBlogPosts } from '@/modules/posts/server/public'
import { getSiteUrl } from '@/lib/server/site-config'
import { routes } from '@/lib/routes'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts()
  const siteUrl = getSiteUrl()

  return [routes.home, routes.blog, ...posts.map(post => routes.post(post.id))].map(path => ({
    url: new URL(path, siteUrl).href,
  }))
}
