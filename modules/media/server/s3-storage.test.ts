// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { createS3MediaStorage } from './s3-storage'

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function createFakeS3Client() {
  const objects = new Map<string, { body: Uint8Array; contentType?: string }>()
  return {
    objects,
    async send(command: unknown) {
      if (command instanceof PutObjectCommand) {
        const { Bucket, Key, Body, ContentType, IfNoneMatch } = command.input
        if (!Bucket || !Key || !(Body instanceof Uint8Array)) throw new Error('Invalid PutObjectCommand')
        if (IfNoneMatch === '*' && objects.has(Key)) {
          const error = new Error('PreconditionFailed')
          error.name = 'PreconditionFailed'
          Reflect.set(error, '$metadata', { httpStatusCode: 412 })
          throw error
        }
        objects.set(Key, { body: new Uint8Array(Body), contentType: ContentType })
        return {}
      }
      if (command instanceof GetObjectCommand) {
        const { Key } = command.input
        const found = Key ? objects.get(Key) : undefined
        if (!found) {
          const error = new Error('NoSuchKey')
          error.name = 'NoSuchKey'
          Reflect.set(error, '$metadata', { httpStatusCode: 404 })
          throw error
        }
        return {
          Body: {
            async transformToByteArray() {
              return found.body
            },
          },
        }
      }
      if (command instanceof DeleteObjectCommand) {
        const { Key } = command.input
        if (Key) objects.delete(Key)
        return {}
      }
      throw new Error('Unexpected S3 command')
    },
  }
}

describe('S3 兼容对象存储后端', () => {
  it('支持写入、条件覆盖校验、哈希完整性检查与删除', async () => {
    const client = createFakeS3Client()
    const storage = createS3MediaStorage(
      {
        bucket: 'nim-bucket',
        region: 'auto',
        endpoint: 'https://r2.example.invalid',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        keyPrefix: '/uploads/',
      },
      client,
    )

    const bytes = new Uint8Array([1, 2, 3, 4])
    const asset = {
      id: randomUUID(),
      mediaType: 'image/webp' as const,
      sha256: sha256(bytes),
    }

    expect(await storage.put(asset, bytes)).toBe('created')
    expect(await storage.put(asset, bytes)).toBe('existing')

    const otherBytes = new Uint8Array([9, 9, 9])
    expect(await storage.put({ ...asset, sha256: sha256(otherBytes) }, otherBytes)).toBe('conflict')

    await expect(storage.put(asset, otherBytes)).rejects.toThrow('Media content hash')
    expect(Buffer.from((await storage.read(asset))!)).toEqual(Buffer.from(bytes))

    client.objects.get(`uploads/${asset.id}.webp`)!.body[0] = 99
    await expect(storage.read(asset)).rejects.toThrow('content integrity check')

    await storage.remove(asset)
    expect(await storage.read(asset)).toBeNull()
  })
})
