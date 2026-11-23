import { z } from 'zod'
import { routes } from '@/lib/routes'

export const mediaIdSchema = z.uuid({ error: 'The media ID must be a UUID.' })

export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024
export const MAX_MEDIA_IMAGE_PIXELS = 40_000_000

export const mediaImageFormats = [
  { format: 'jpeg', mediaType: 'image/jpeg', extension: 'jpg' },
  { format: 'png', mediaType: 'image/png', extension: 'png' },
  { format: 'gif', mediaType: 'image/gif', extension: 'gif' },
  { format: 'webp', mediaType: 'image/webp', extension: 'webp' },
] as const

export const mediaTypeSchema = z.enum(mediaImageFormats.map(format => format.mediaType))
export const mediaStateSchema = z.enum(['pending', 'ready'])
export type MediaType = z.infer<typeof mediaTypeSchema>

const mediaAssetFieldsSchema = z.object({
  id: mediaIdSchema,
  originalName: z.string().min(1).max(200),
  mediaType: mediaTypeSchema,
  byteSize: z.number().int().positive().max(MAX_MEDIA_UPLOAD_BYTES),
  width: z.number().int().positive().safe(),
  height: z.number().int().positive().safe(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: mediaStateSchema,
  createdAt: z.iso.datetime(),
}).strict()

export const mediaAssetSchema = mediaAssetFieldsSchema.superRefine((asset, context) => {
  if (asset.width * asset.height > MAX_MEDIA_IMAGE_PIXELS) {
    context.addIssue({ code: 'custom', path: ['width'], message: 'The image dimensions exceed the pixel limit.' })
  }
})

export type MediaAsset = z.infer<typeof mediaAssetSchema>

export function mediaMarkdownUrl(id: string) {
  return routes.media(mediaIdSchema.parse(id))
}

export const mediaUploadResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    media: mediaAssetFieldsSchema.pick({ id: true, originalName: true, mediaType: true, width: true, height: true })
      .extend({ url: z.string() }).strict().superRefine((media, context) => {
        if (media.url !== mediaMarkdownUrl(media.id)) {
          context.addIssue({ code: 'custom', path: ['url'], message: 'The media URL does not match its identity.' })
        }
      }),
  }).strict(),
  z.object({ status: z.literal('error'), message: z.string() }).strict(),
])

export type MediaUploadResponse = z.infer<typeof mediaUploadResponseSchema>
