import type { MetadataRoute } from 'next'
import { getBlogPosts } from '@/lib/blog'
import { getSiteUrl } from '@/lib/server/site-config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts()
  const siteUrl = getSiteUrl()

  return ['/', ...posts.map(post => `/blog/${post.id}`)].map(path => ({
    url: new URL(path, siteUrl).href,
  }))
}
