'use server'

import { revalidatePath } from 'next/cache'
import { routes } from '@/lib/routes'
import { runAdminAction, type AdminActionError } from '@/modules/auth/server/admin-action'
import { saveHomeConfigSchema, type SaveHomeConfigInput } from '../../home-model'
import { withAdminHomeStore } from '../home'
import type { HomeStore } from '../home-store'

export type SaveHomeConfigFeedback =
  | { status: 'success' }
  | { status: 'invalid'; message: string }
  | AdminActionError

export async function saveHomeConfigAction(
  input: SaveHomeConfigInput,
): Promise<SaveHomeConfigFeedback> {
  const parsed = saveHomeConfigSchema.safeParse(input)
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Check homepage settings and try again.',
    }
  }

  return runAdminAction<HomeStore, Exclude<SaveHomeConfigFeedback, AdminActionError>>(
    withAdminHomeStore,
    {
      unauthorizedMessage: 'Sign in to manage homepage sections.',
      errorLog: '保存首页策展配置失败。',
      errorMessage: 'Could not save homepage settings. Please try again.',
    },
    async store => {
      await store.saveConfig(parsed.data)
      revalidatePath(routes.home)
      revalidatePath(routes.admin.homepage)
      return { status: 'success' }
    },
  )
}
