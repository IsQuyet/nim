import { describe, expect, it } from 'vitest'
import { mediaAssetSchema, mediaMarkdownUrl, mediaUploadResponseSchema, MAX_MEDIA_UPLOAD_BYTES } from './media'

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const asset = {
  id, originalName: 'photo.png', mediaType: 'image/webp', byteSize: 100,
  width: 2, height: 3, sha256: 'a'.repeat(64), state: 'ready', createdAt: '2026-11-17T00:00:00.000Z',
}

describe('媒体共享契约', () => {
  it('媒体元数据与响应使用同一身份和字段约束', () => {
    expect(mediaAssetSchema.parse(asset)).toEqual(asset)
    expect(mediaMarkdownUrl(id)).toBe(`/media/${id}`)
    expect(mediaUploadResponseSchema.parse({ status: 'success', media: {
      id, originalName: asset.originalName, mediaType: asset.mediaType,
      width: asset.width, height: asset.height, url: mediaMarkdownUrl(id),
    } })).toMatchObject({ status: 'success' })
  })

  it.each([
    { ...asset, id: '../other' },
    { ...asset, mediaType: 'image/svg+xml' },
    { ...asset, byteSize: MAX_MEDIA_UPLOAD_BYTES + 1 },
    { ...asset, width: 10000, height: 10000 },
    { ...asset, sha256: 'invalid' },
    { ...asset, state: 'unknown' },
  ])('拒绝不满足媒体不变量的元数据', input => {
    expect(mediaAssetSchema.safeParse(input).success).toBe(false)
  })

  it('响应中的媒体 URL 必须与身份一致', () => {
    expect(mediaUploadResponseSchema.safeParse({ status: 'success', media: {
      id, originalName: asset.originalName, mediaType: asset.mediaType,
      width: asset.width, height: asset.height, url: '/media/different',
    } }).success).toBe(false)
  })
})
