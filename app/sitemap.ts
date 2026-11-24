import type { MetadataRoute } from 'next'
import { getGalleryItems } from '@/modules/gallery/server/public'
import { getBlogPosts } from '@/modules/posts/server/public'
import { getSiteUrl } from '@/lib/server/site-config'
import { routes } from '@/lib/routes'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, gallery] = await Promise.all([getBlogPosts(), getGalleryItems()])
  const siteUrl = getSiteUrl()

  return [
    routes.home,
    routes.blog,
    routes.gallery,
    ...posts.map(post => routes.post(post.id)),
    ...gallery.map(item => routes.galleryItem(item.id)),
  ].map(path => ({
    url: new URL(path, siteUrl).href,
  }))
}
