import { z } from 'zod'
import { publishedPostSchema } from './model'

export const publishedPostReadSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    value: publishedPostSchema.nullable(),
  }).strict(),
  z.object({
    status: z.literal('error'),
    message: z.string(),
    signInRequired: z.literal(true).optional(),
  }).strict(),
])

export type PublishedPostRead = z.infer<typeof publishedPostReadSchema>
