import { describe, expect, it } from 'vitest'
import { getSiteUrl } from './site-config'

describe('站点部署地址', () => {
  it.each(['development', 'test', undefined])(
    '非生产环境 %s 未配置时使用 localhost',
    (mode) => {
      expect(getSiteUrl({ NODE_ENV: mode }).href).toBe('http://localhost:3000/')
    },
  )

  it.each([undefined, '', '  '])(
    '生产模式拒绝缺失或空白的站点地址：%s',
    (value) => {
      expect(() =>
        getSiteUrl({ NODE_ENV: 'production', SITE_URL: value }),
      ).toThrow('生产构建必须设置 SITE_URL')
    },
  )

  it('Vercel 预览环境未配置 SITE_URL 时自动使用 VERCEL_URL', () => {
    expect(
      getSiteUrl({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        VERCEL_URL: 'nim-git-feat-demo.vercel.app',
      }).href,
    ).toBe('https://nim-git-feat-demo.vercel.app/')
  })

  it('Vercel 生产环境仍强制要求显式配置 SITE_URL', () => {
    expect(() =>
      getSiteUrl({
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        VERCEL_URL: 'nim-abc123.vercel.app',
      }),
    ).toThrow('生产构建必须设置 SITE_URL')
  })

  it('使用正式域名，去除首尾空格并规范尾部斜杠', () => {
    expect(
      getSiteUrl({ NODE_ENV: 'production', SITE_URL: ' https://example.test ' })
        .href,
    ).toBe('https://example.test/')
  })

  it('允许本地生产预览使用回环地址和端口', () => {
    expect(
      getSiteUrl({ NODE_ENV: 'production', SITE_URL: 'http://127.0.0.1:3100' }).href,
    ).toBe('http://127.0.0.1:3100/')
  })

  it.each([
    ['缺少协议', 'example.test', '完整的 HTTP 或 HTTPS 站点地址'],
    ['非 HTTP 协议', 'ftp://example.test', '站点根地址'],
    ['凭据', 'https://user:password@example.test', '站点根地址'],
    ['子路径', 'https://example.test/blog', '站点根地址'],
    ['查询参数', 'https://example.test/?preview=true', '站点根地址'],
    ['空查询部分', 'https://example.test/?', '站点根地址'],
    ['片段', 'https://example.test/#home', '站点根地址'],
    ['空片段', 'https://example.test/#', '站点根地址'],
  ])('拒绝包含%s的配置，不静默截断', (_reason, value, message) => {
    expect(() => getSiteUrl({ SITE_URL: value })).toThrow(message)
  })
})
