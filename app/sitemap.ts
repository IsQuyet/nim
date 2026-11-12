import type { MetadataRoute } from 'next'
import { BLOG_POSTS } from './data'
import { getSiteUrl } from '@/lib/site-config'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl()

  return ['/', ...BLOG_POSTS.map(post => post.link)].map(path => ({
    url: new URL(path, siteUrl).href,
  }))
}
