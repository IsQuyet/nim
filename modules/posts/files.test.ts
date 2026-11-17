import assert from 'node:assert/strict'
import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config.mjs'
import { MAX_MARKDOWN_UPLOAD_BYTES } from './files'

describe('Markdown 上传资源策略', () => {
  it('HTTP 动作上限为文件及 multipart 字段预留空间', () => {
    const limit = nextConfig.experimental?.serverActions?.bodySizeLimit
    assert.ok(typeof limit === 'number')
    expect(limit).toBeGreaterThanOrEqual(MAX_MARKDOWN_UPLOAD_BYTES + 20 * 1024)
  })
})
