import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, link, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { mediaIdSchema, mediaImageFormats, mediaTypeSchema, type MediaAsset } from '../model'

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
