'use server'

import { revalidatePath } from 'next/cache'
import { routes } from '@/lib/routes'
import { runAdminAction, type AdminActionError } from '@/modules/auth/server/admin-action'
import {
  galleryIdSchema,
  galleryStatusSchema,
  saveGalleryItemSchema,
  type GalleryItem,
  type GalleryStatus,
  type SaveGalleryItemInput,
} from '../../model'
import { withAdminGalleryStore } from '../admin'
import type { GalleryStore } from '../store'

export type SaveGalleryFeedback =
  | { status: 'success'; item: GalleryItem }
  | { status: 'invalid'; message: string }
  | { status: 'missing'; message: string }
  | AdminActionError

export type SetGalleryStatusFeedback =
  | { status: 'success'; item: GalleryItem }
  | { status: 'invalid'; message: string }
  | { status: 'missing'; message: string }
  | AdminActionError

export type DeleteGalleryFeedback =
  | { status: 'success'; id: string }
  | { status: 'invalid'; message: string }
  | { status: 'missing'; message: string }
  | AdminActionError

function revalidateGalleryPaths(id?: string) {
  revalidatePath(routes.home)
  revalidatePath(routes.gallery)
  if (id) revalidatePath(routes.galleryItem(id))
  revalidatePath(routes.admin.gallery)
  revalidatePath(routes.admin.media)
  revalidatePath(routes.admin.homepage)
  revalidatePath('/sitemap.xml')
}

export async function saveGalleryItemAction(input: SaveGalleryItemInput): Promise<SaveGalleryFeedback> {
  const parsed = saveGalleryItemSchema.safeParse(input)
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Check the gallery fields and try again.',
    }
  }

  return runAdminAction<GalleryStore, Exclude<SaveGalleryFeedback, AdminActionError>>(
    withAdminGalleryStore,
    {
      unauthorizedMessage: 'Sign in to manage gallery photos.',
      errorLog: '保存画廊作品失败。',
      errorMessage: 'Could not save this gallery item. Please try again.',
    },
    async store => {
      const result = await store.save(parsed.data)
      if (result.status === 'missing') {
        return { status: 'missing', message: 'This gallery item no longer exists.' }
      }
      if (result.status === 'invalid') return result
      revalidateGalleryPaths(result.item.id)
      return result
    },
  )
}

export async function setGalleryStatusAction(
  id: unknown,
  status: unknown,
): Promise<SetGalleryStatusFeedback> {
  const parsedId = galleryIdSchema.safeParse(id)
  const parsedStatus = galleryStatusSchema.safeParse(status)
  if (!parsedId.success || !parsedStatus.success) {
    return { status: 'invalid', message: 'Invalid gallery update request.' }
  }

  return runAdminAction<GalleryStore, Exclude<SetGalleryStatusFeedback, AdminActionError>>(
    withAdminGalleryStore,
    {
      unauthorizedMessage: 'Sign in to manage gallery photos.',
      errorLog: '更新画廊发布状态失败。',
      errorMessage: 'Could not update the publish status. Please try again.',
    },
    async store => {
      const result = await store.setStatus(parsedId.data, parsedStatus.data as GalleryStatus)
      if (result.status === 'missing') {
        return { status: 'missing', message: 'This gallery item no longer exists.' }
      }
      if (result.status === 'invalid') return result
      revalidateGalleryPaths(result.item.id)
      return result
    },
  )
}

export async function deleteGalleryItemAction(id: unknown): Promise<DeleteGalleryFeedback> {
  const parsedId = galleryIdSchema.safeParse(id)
  if (!parsedId.success) {
    return { status: 'invalid', message: 'Invalid gallery item ID.' }
  }

  return runAdminAction<GalleryStore, Exclude<DeleteGalleryFeedback, AdminActionError>>(
    withAdminGalleryStore,
    {
      unauthorizedMessage: 'Sign in to remove gallery photos.',
      errorLog: '删除画廊作品失败。',
      errorMessage: 'Could not delete this gallery item. Please try again.',
    },
    async store => {
      const result = await store.remove(parsedId.data)
      if (result.status === 'missing') {
        return { status: 'missing', message: 'This gallery item no longer exists.' }
      }
      revalidateGalleryPaths(result.id)
      return result
    },
  )
}
