import { z } from 'zod'

const text = z.string({ error: 'The draft fields must contain text.' })

export const postContentSchema = z.object({
  title: text.refine(title => title.trim().length > 0, { error: 'Enter a title.' }),
  description: text,
  body: text,
}, { error: 'The draft fields must contain text.' })

export type PostContent = z.infer<typeof postContentSchema>

export const postContentFields = postContentSchema.keyof().options

export function samePostContent(left: PostContent, right: PostContent) {
  return postContentFields.every(field => left[field] === right[field])
}

export type DraftPost = PostContent & {
  id: string
  createdAt: string
  updatedAt: string
}

export type PublishedPost = PostContent & {
  id: string
  createdAt: string
  publishedAt: string
}

export type PublishedPostSummary = Pick<
  PublishedPost,
  'id' | 'title' | 'description' | 'publishedAt'
>

export const postStatusSchema = z.enum(['draft', 'published', 'modified'])

export type PostSummary = Pick<
  DraftPost,
  'id' | 'title' | 'description' | 'updatedAt'
> & {
  status: z.infer<typeof postStatusSchema>
}

export type ImportPostInput = PostContent & {
  id: string
}
