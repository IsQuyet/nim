// @vitest-environment node
import { createHash } from 'node:crypto'
import { crc32 } from 'node:zlib'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createTestAnimation, createTestImage } from '../test/media-fixtures'
import { MAX_MEDIA_UPLOAD_BYTES } from './media'
import { prepareMediaUpload } from './media-upload'

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

async function prepare(bytes: Uint8Array, declaredType = 'image/png', originalName = 'photo.png') {
  return prepareMediaUpload({ id, originalName, declaredType, bytes })
}

describe('服务器图像解码与无损编码', () => {
  it.each([
    { format: 'png', type: 'image/png' },
    { format: 'jpeg', type: 'image/jpeg' },
    { format: 'gif', type: 'image/gif' },
    { format: 'webp', type: 'image/webp' },
  ] as const)('$format 完整解码后输出 WebP，保留显示像素并以输出内容计算摘要', async ({ format, type }) => {
    const source = await createTestImage(format)
    const result = await prepare(source, type, `folder\\photo.${format}`)
    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error(result.message)
    const output = await sharp(result.value.bytes).metadata()
    expect(result.value).toMatchObject({
      id, originalName: `photo.${format}`, mediaType: 'image/webp', width: 2, height: 3,
      byteSize: result.value.bytes.byteLength,
      sha256: createHash('sha256').update(result.value.bytes).digest('hex'),
    })
    expect(output.format).toBe('webp')
    expect(await sharp(result.value.bytes).ensureAlpha().raw().toBuffer())
      .toEqual(await sharp(source).ensureAlpha().raw().toBuffer())
  })

  it('同一文件重试产生相同的存储内容与摘要', async () => {
    const source = await createTestImage()
    const first = await prepare(source)
    const second = await prepare(source)
    expect(first.status).toBe('success')
    expect(second).toEqual(first)
  })

  it('根据 EXIF 方向旋转显示像素，并移除源 EXIF、ICC 和 XMP', async () => {
    const source = await sharp(await createTestImage())
      .withExif({ IFD0: { Artist: 'Private author', ImageDescription: 'Private location' } })
      .withMetadata({ orientation: 6 })
      .png().toBuffer()
    expect((await sharp(source).metadata()).exif).toBeDefined()
    const result = await prepare(source)
    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error(result.message)
    const output = await sharp(result.value.bytes).metadata()
    expect(result.value).toMatchObject({ width: 3, height: 2 })
    expect(output.exif).toBeUndefined()
    expect(output.icc).toBeUndefined()
    expect(output.xmp).toBeUndefined()
    expect(output.orientation).toBeUndefined()
    expect(await sharp(result.value.bytes).ensureAlpha().raw().toBuffer())
      .toEqual(await sharp(source).autoOrient().ensureAlpha().raw().toBuffer())
  })

  it.each(['gif', 'webp'] as const)('保留 %s 动画的帧、时长、循环与透明度', async format => {
    const source = await createTestAnimation(format)
    const result = await prepare(source, `image/${format}`, `animation.${format}`)
    expect(result.status).toBe('success')
    if (result.status !== 'success') throw new Error(result.message)
    const metadata = await sharp(result.value.bytes, { animated: true }).metadata()
    expect(metadata).toMatchObject({ format: 'webp', pages: 2, pageHeight: 1, width: 2, loop: 2, delay: [80, 160], hasAlpha: true })
    expect(result.value).toMatchObject({ width: 2, height: 1 })
    expect(await sharp(result.value.bytes, { animated: true }).ensureAlpha().raw().toBuffer())
      .toEqual(await sharp(source, { animated: true }).ensureAlpha().raw().toBuffer())
  })

  it('拒绝伪造 MIME、只有头部的图片和超限文件，不接受 SVG', async () => {
    const source = await createTestImage()
    expect(await prepare(source, 'image/jpeg')).toMatchObject({ status: 'invalid' })
    expect(await prepare(source.subarray(0, 32))).toMatchObject({ status: 'invalid' })
    expect(await prepare(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'), 'image/svg+xml'))
      .toMatchObject({ status: 'invalid' })
    expect(await prepare(new Uint8Array())).toMatchObject({ status: 'invalid' })
    expect(await prepare(new Uint8Array(MAX_MEDIA_UPLOAD_BYTES + 1))).toMatchObject({ status: 'invalid' })
  })

  it('拒绝过大的解码画布，处理前不尝试分配全部像素', async () => {
    const source = Buffer.from(await createTestImage())
    source.writeUInt32BE(10000, 16)
    source.writeUInt32BE(10000, 20)
    source.writeUInt32BE(crc32(source.subarray(12, 29)), 29)
    expect(await prepare(source)).toMatchObject({ status: 'invalid' })
  })
})
