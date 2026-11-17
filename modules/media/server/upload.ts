import 'server-only'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { MAX_MEDIA_UPLOAD_BYTES, MAX_MEDIA_IMAGE_PIXELS, mediaAssetSchema, mediaIdSchema, mediaImageFormats, type MediaAsset } from '../model'

export type PreparedMedia = Omit<MediaAsset, 'state' | 'createdAt'> & { bytes: Uint8Array }

type MediaPreparation =
  | { status: 'success'; value: PreparedMedia }
  | { status: 'invalid'; message: string }

function originalName(value: unknown) {
  if (typeof value !== 'string') return null
  const base = value.split(/[\\/]/).at(-1)?.normalize('NFC').trim()
  return base && base.length <= 200 && !/[\u0000-\u001f\u007f]/.test(base) ? base : null
}

export async function prepareMediaUpload(input: {
  id: unknown
  originalName: unknown
  declaredType: unknown
  bytes: Uint8Array
}): Promise<MediaPreparation> {
  const id = mediaIdSchema.safeParse(input.id)
  if (!id.success) return { status: 'invalid', message: id.error.issues[0].message }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    return { status: 'invalid', message: 'Choose a non-empty image file.' }
  }
  if (input.bytes.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
    return { status: 'invalid', message: `Images must be ${MAX_MEDIA_UPLOAD_BYTES / 1024 / 1024} MiB or smaller.` }
  }
  const name = originalName(input.originalName)
  if (!name) return { status: 'invalid', message: 'The image filename is invalid.' }

  try {
    const image = sharp(input.bytes, {
      animated: true,
      failOn: 'warning',
      limitInputPixels: MAX_MEDIA_IMAGE_PIXELS,
    })
    const metadata = await image.metadata()
    const format = mediaImageFormats.find(format => format.format === metadata.format)
    if (!format || format.mediaType !== input.declaredType) {
      return { status: 'invalid', message: 'Choose a valid JPEG, PNG, GIF, or WebP image.' }
    }
    if (metadata.width * metadata.height > MAX_MEDIA_IMAGE_PIXELS) {
      return { status: 'invalid', message: 'The image dimensions exceed the 40 megapixel limit.' }
    }

    // 编码会读取全部像素和动画帧，不能把读取头部成功当作文件完整性校验。
    const { data, info } = await image.autoOrient()
      .webp({ lossless: true, effort: 4, loop: metadata.loop, delay: metadata.delay })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true })
    if (data.byteLength > MAX_MEDIA_UPLOAD_BYTES) {
      return { status: 'invalid', message: 'The processed image exceeds the 10 MiB limit. Choose a smaller image.' }
    }

    const asset = mediaAssetSchema.parse({
      id: id.data,
      originalName: name,
      mediaType: 'image/webp',
      byteSize: data.byteLength,
      width: info.width,
      height: info.pageHeight ?? info.height,
      sha256: createHash('sha256').update(data).digest('hex'),
      state: 'pending',
      createdAt: new Date().toISOString(),
    })
    return { status: 'success', value: {
      id: asset.id, originalName: asset.originalName, mediaType: asset.mediaType,
      byteSize: asset.byteSize, width: asset.width, height: asset.height, sha256: asset.sha256, bytes: data,
    } }
  } catch {
    return { status: 'invalid', message: 'The image is incomplete, invalid, or exceeds the image processing limits.' }
  }
}
