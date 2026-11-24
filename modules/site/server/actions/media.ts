'use server'

import { revalidatePath } from 'next/cache'
import { routes } from '@/lib/routes'
import type { AppDatabase } from '@/lib/server/database'
import { runAdminAction } from '@/modules/auth/server/admin-action'
import type { MediaStorage } from '@/modules/media/server/storage'
import type { DeleteMediaFeedback } from '../../media'
import { deleteSiteAdminMedia, withAdminSiteMediaDatabase } from '../media-admin'

export type { DeleteMediaFeedback }

type MediaAdminContext = { database: AppDatabase; storage: MediaStorage }

export async function deleteMediaAssetAction(id: unknown): Promise<DeleteMediaFeedback> {
  return runAdminAction<MediaAdminContext, DeleteMediaFeedback>(
    operation => withAdminSiteMediaDatabase((database, storage) => operation({ database, storage })),
    {
      unauthorizedMessage: 'Sign in to manage media.',
      errorLog: '删除媒体资源失败。',
      errorMessage: 'Could not delete the media file. Please try again.',
    },
    async ({ database, storage }) => {
      const deleted = await deleteSiteAdminMedia(database, storage, id)
      if (deleted.status === 'invalid' || deleted.status === 'referenced') {
        return { status: 'error' as const, message: deleted.message }
      }
      if (deleted.status === 'missing') {
        return { status: 'error' as const, message: 'This media asset no longer exists.' }
      }
      revalidatePath(routes.admin.media)
      return deleted
    },
  )
}
