import { routes } from '@/lib/routes'
import { mediaUploadResponseSchema, type MediaUploadResponse } from './model'

export type UploadedMedia = Extract<MediaUploadResponse, { status: 'success' }>['media']

/** 将本地选择的图片文件通过统一上传接口写入媒体库并返回校验后的元数据。 */
export async function uploadMediaFile({
  id,
  file,
  signal,
}: {
  id: string
  file: File
  signal?: AbortSignal
}): Promise<UploadedMedia> {
  const form = new FormData()
  form.set('id', id)
  form.set('file', file)
  const response = await fetch(routes.admin.mediaUpload, { method: 'POST', body: form, signal })
  const raw: unknown = await response.json()
  const result = mediaUploadResponseSchema.safeParse(raw)
  if (!result.success) throw new Error('The upload response was invalid.')
  if (!response.ok || result.data.status === 'error') {
    throw new Error(result.data.status === 'error' ? result.data.message : 'Could not upload the image.')
  }
  if (result.data.media.id !== id) {
    throw new Error('The upload response belongs to a different image.')
  }
  return result.data.media
}
