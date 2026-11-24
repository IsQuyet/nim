import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, link, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { getMediaDirectory } from '@/lib/server/data-paths'
import { mediaIdSchema, mediaImageFormats, mediaTypeSchema, type MediaAsset } from '../model'
import { createS3MediaStorage } from './s3-storage'

export { createS3MediaStorage }

type StoredMedia = Pick<MediaAsset, 'id' | 'mediaType' | 'sha256'>

export type MediaStorage = {
  put(asset: StoredMedia, bytes: Uint8Array): Promise<'created' | 'existing' | 'conflict'>
  read(asset: StoredMedia): Promise<Uint8Array | null>
  remove(asset: Pick<StoredMedia, 'id' | 'mediaType'>): Promise<void>
}

function filename(root: string, asset: Pick<StoredMedia, 'id' | 'mediaType'>) {
  const id = mediaIdSchema.parse(asset.id)
  const mediaType = mediaTypeSchema.parse(asset.mediaType)
  const format = mediaImageFormats.find(format => format.mediaType === mediaType)
  if (!format) throw new Error('Unsupported media storage format.')
  return join(/* turbopackIgnore: true */ root, `${id}.${format.extension}`)
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function hasFilesystemCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function matchesExisting(path: string, expectedHash: string) {
  try {
    return sha256(await readFile(path)) === expectedHash
  } catch (error) {
    if (hasFilesystemCode(error, 'ENOENT')) return false
    throw error
  }
}

export function createFileMediaStorage(root: string): MediaStorage {
  return {
    async put(asset, bytes) {
      if (sha256(bytes) !== asset.sha256) throw new Error('Media content hash does not match its metadata.')
      await mkdir(root, { recursive: true, mode: 0o700 })
      const destination = filename(root, asset)
      const staging = join(root, `.${asset.id}.${randomUUID()}.tmp`)
      const file = await open(staging, 'wx', 0o600)
      try {
        try {
          await file.writeFile(bytes)
          await file.sync()
        } finally {
          await file.close()
        }
        try {
          await link(staging, destination)
          return 'created'
        } catch (error) {
          if (!hasFilesystemCode(error, 'EEXIST')) throw error
          if (!(await matchesExisting(destination, asset.sha256))) return 'conflict'
          return 'existing'
        }
      } finally {
        await rm(staging, { force: true })
      }
    },

    async read(asset) {
      try {
        const bytes = await readFile(/* turbopackIgnore: true */ filename(root, asset))
        if (sha256(bytes) !== asset.sha256) throw new Error('Stored media failed its content integrity check.')
        return bytes
      } catch (error) {
        if (hasFilesystemCode(error, 'ENOENT')) return null
        throw error
      }
    },

    async remove(asset) {
      await rm(filename(root, asset), { force: true })
    },
  }
}

/** 按环境选择媒体存储后端：配置了 S3/R2 桶时走对象存储，否则写入本地持久化目录。 */
export function createConfiguredMediaStorage(): MediaStorage {
  const bucket = process.env.S3_BUCKET?.trim()
  if (!bucket) return createFileMediaStorage(getMediaDirectory())

  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('已设置 S3_BUCKET，但缺少 S3_ACCESS_KEY_ID 或 S3_SECRET_ACCESS_KEY。')
  }

  return createS3MediaStorage({
    bucket,
    region: process.env.S3_REGION?.trim() || 'auto',
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    accessKeyId,
    secretAccessKey,
    keyPrefix: process.env.S3_KEY_PREFIX?.trim() || 'media',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() === 'true',
  })
}
