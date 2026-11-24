import { createHash } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { mediaIdSchema, mediaImageFormats, mediaTypeSchema, type MediaAsset } from '../model'
import type { MediaStorage } from './storage'

export type S3MediaStorageConfig = {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
  keyPrefix?: string
  forcePathStyle?: boolean
}

type S3Sender = Pick<S3Client, 'send'>

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function objectKey(prefix: string, asset: Pick<MediaAsset, 'id' | 'mediaType'>) {
  const id = mediaIdSchema.parse(asset.id)
  const mediaType = mediaTypeSchema.parse(asset.mediaType)
  const format = mediaImageFormats.find(item => item.mediaType === mediaType)
  if (!format) throw new Error('Unsupported media storage format.')
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '')
  return normalizedPrefix ? `${normalizedPrefix}/${id}.${format.extension}` : `${id}.${format.extension}`
}

function hasStatusCode(error: unknown, codes: number[], names: string[]) {
  if (!(error instanceof Error)) return false
  const metaStatus = Reflect.get(error, '$metadata')
  const httpStatus = typeof metaStatus === 'object' && metaStatus !== null
    ? Reflect.get(metaStatus, 'httpStatusCode')
    : undefined
  if (typeof httpStatus === 'number' && codes.includes(httpStatus)) return true
  const errorName = error.name
  const code = Reflect.get(error, 'Code') ?? Reflect.get(error, 'code')
  return names.includes(errorName) || (typeof code === 'string' && names.includes(code))
}

function isMissingObject(error: unknown) {
  return hasStatusCode(error, [404], ['NoSuchKey', 'NotFound'])
}

function isPreconditionFailed(error: unknown) {
  return hasStatusCode(error, [409, 412], ['PreconditionFailed', 'ConditionalRequestConflict'])
}

export function createS3MediaStorage(
  config: S3MediaStorageConfig,
  client: S3Sender = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }),
): MediaStorage {
  const prefix = config.keyPrefix ?? 'media'

  async function readRaw(key: string): Promise<Uint8Array | null> {
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      if (!response.Body) return null
      return await response.Body.transformToByteArray()
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  return {
    async put(asset, bytes) {
      if (sha256(bytes) !== asset.sha256) throw new Error('Media content hash does not match its metadata.')
      const key = objectKey(prefix, asset)
      try {
        await client.send(new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: asset.mediaType,
          IfNoneMatch: '*',
          Metadata: { sha256: asset.sha256 },
        }))
        return 'created'
      } catch (error) {
        if (!isPreconditionFailed(error)) throw error
        const existing = await readRaw(key)
        if (!existing) throw error
        return sha256(existing) === asset.sha256 ? 'existing' : 'conflict'
      }
    },

    async read(asset) {
      const bytes = await readRaw(objectKey(prefix, asset))
      if (!bytes) return null
      if (sha256(bytes) !== asset.sha256) throw new Error('Stored media failed its content integrity check.')
      return bytes
    },

    async remove(asset) {
      try {
        await client.send(new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: objectKey(prefix, asset),
        }))
      } catch (error) {
        if (!isMissingObject(error)) throw error
      }
    },
  }
}
