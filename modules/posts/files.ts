import { z } from 'zod'

export const MAX_MARKDOWN_UPLOAD_BYTES = 5 * 1024 * 1024

export const postFileStageSchema = z.enum(['draft', 'published'])
export type PostFileStage = z.infer<typeof postFileStageSchema>
export type PostFileFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string; signInRequired?: true; reviewPostId?: string }
