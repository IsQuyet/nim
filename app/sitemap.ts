import type { MetadataRoute } from 'next'
import { getBlogPosts } from '@/lib/blog'
import { getSiteUrl } from '@/lib/site-config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getBlogPosts()
  const siteUrl = getSiteUrl()

  return ['/', ...posts.map(post => `/blog/${post.slug}`)].map(path => ({
    url: new URL(path, siteUrl).href,
  }))
}
