import type { MediaAsset } from '@/modules/media/model'

export type AdminMediaReference = {
  postId: string
  title: string
  inDraft: boolean
  inPublished: boolean
  publicationCount: number
}

export type AdminMediaItem = {
  asset: MediaAsset
  references: AdminMediaReference[]
}

export type DeleteMediaFeedback =
  | { status: 'success'; id: string }
  | { status: 'error'; message: string; signInRequired?: true }
