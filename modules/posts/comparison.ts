import { z } from 'zod'
import { actionFailureSchema } from '@/modules/auth/failure'
import { publishedPostSchema } from './model'

export const publishedPostReadSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    value: publishedPostSchema.nullable(),
  }).strict(),
  actionFailureSchema,
])

export type PublishedPostRead = z.infer<typeof publishedPostReadSchema>
