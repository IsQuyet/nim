import type { MetadataRoute } from 'next'
import { getSiteUrl } from '@/lib/server/site-config'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: new URL('/sitemap.xml', getSiteUrl()).href,
  }
}
