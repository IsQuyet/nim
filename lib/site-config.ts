type SiteEnvironment = Readonly<Record<string, string | undefined>>

export function getSiteUrl(environment: SiteEnvironment = process.env): URL {
  const configuredUrl = environment.SITE_URL?.trim()

  if (!configuredUrl) {
    if (environment.NODE_ENV === 'production') {
      throw new Error('生产构建必须设置 SITE_URL。')
    }

    return new URL('http://localhost:3000')
  }

  let url: URL
  try {
    url = new URL(configuredUrl)
  } catch {
    throw new Error('SITE_URL 必须是完整的 HTTP 或 HTTPS 站点地址。')
  }

  const isHttp = url.protocol === 'http:' || url.protocol === 'https:'
  const isSiteRoot = url.href === `${url.origin}/`

  if (!isHttp || !isSiteRoot) {
    throw new Error('SITE_URL 必须是 HTTP 或 HTTPS 站点根地址。')
  }

  return url
}
