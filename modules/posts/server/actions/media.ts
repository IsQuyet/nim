'use server'

import { revalidatePath } from 'next/cache'
import type { AppDatabase } from '@/lib/server/database'
import type { MediaStorage } from '@/modules/media/server/storage'
import { routes } from '@/lib/routes'
import type { DeleteMediaFeedback } from '../../media'
import { withAdminMediaDatabase } from '../admin'
import { deleteAdminMedia } from '../media-admin'
import { runAdminAction } from './run'

export type { DeleteMediaFeedback }

type MediaAdminContext = { database: AppDatabase; storage: MediaStorage }

export async function deleteMediaAssetAction(id: unknown): Promise<DeleteMediaFeedback> {
  return runAdminAction<MediaAdminContext, DeleteMediaFeedback>(
    operation => withAdminMediaDatabase((database, storage) => operation({ database, storage })),
    {
      unauthorizedMessage: 'Sign in to manage media.',
      errorLog: '删除媒体资源失败。',
      errorMessage: 'Could not delete the media file. Please try again.',
    },
    async ({ database, storage }) => {
      const deleted = await deleteAdminMedia(database, storage, id)
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
