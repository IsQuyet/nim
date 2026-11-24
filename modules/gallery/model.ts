import { z } from 'zod'
import { mediaIdSchema, type MediaAsset } from '@/modules/media/model'

export const galleryIdSchema = z.uuid({ error: 'The gallery item ID must be a UUID.' })
export const galleryStatusSchema = z.enum(['draft', 'published'])
export type GalleryStatus = z.infer<typeof galleryStatusSchema>

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const optionalDateSchema = z
  .string()
  .trim()
  .transform(value => (value === '' ? null : value))
  .nullable()
  .refine(value => value === null || isCalendarDate(value), {
    error: 'Use YYYY-MM-DD for the date taken.',
  })

export const saveGalleryItemSchema = z.object({
  id: galleryIdSchema.optional(),
  mediaId: mediaIdSchema,
  title: z.string().trim().min(1, { error: 'Enter a title.' }).max(160, { error: 'Title must be 160 characters or fewer.' }),
  caption: z.string().trim().max(1000, { error: 'Caption must be 1000 characters or fewer.' }).default(''),
  location: z.string().trim().max(120, { error: 'Location must be 120 characters or fewer.' }).default(''),
  takenAt: optionalDateSchema.default(null),
  status: galleryStatusSchema,
}).strict()

export type SaveGalleryItemInput = z.input<typeof saveGalleryItemSchema>
export type ParsedGalleryItemInput = z.output<typeof saveGalleryItemSchema>

export type GalleryMediaSummary = Pick<MediaAsset, 'id' | 'originalName' | 'mediaType' | 'width' | 'height'>

export type GalleryItem = {
  id: string
  mediaId: string
  title: string
  caption: string
  location: string
  takenAt: string | null
  status: GalleryStatus
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  media: GalleryMediaSummary
}

export type PublishedGalleryItem = GalleryItem & {
  status: 'published'
  publishedAt: string
}

export type GalleryMediaReference = {
  galleryId: string
  title: string
  status: GalleryStatus
}
