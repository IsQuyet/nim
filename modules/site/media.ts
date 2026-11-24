import type { MediaAsset } from '@/modules/media/model'
import type { AdminMediaReference } from '@/modules/posts/media'
import type { GalleryMediaReference } from '@/modules/gallery/model'

export type { AdminMediaReference, GalleryMediaReference }

export type SiteMediaItem = {
  asset: MediaAsset
  postReferences: AdminMediaReference[]
  galleryReferences: GalleryMediaReference[]
}

export type DeleteMediaFeedback =
  | { status: 'success'; id: string }
  | { status: 'error'; message: string; signInRequired?: true }
