import type { Route } from 'next'

// 地址由 app/ 的目录结构决定。这里的每个地址都经 Next 生成的路由类型校验，路由目录变动后不再存在的地址无法通过类型检查。
function route<T extends string>(path: Route<T>) {
  return path
}

// 正文里引用站内图片的地址以它开头，发布时据此识别媒体引用。
export const MEDIA_PATH_PREFIX = '/media/'

export const routes = {
  home: route('/'),
  blog: route('/blog'),
  post: (id: string) => route(`/blog/${id}`),
  media: (id: string) => route(`${MEDIA_PATH_PREFIX}${id}`),
  admin: {
    home: route('/admin'),
    login: route('/admin/login'),
    import: route('/admin/import'),
    newPost: route('/admin/posts/new'),
    newDraft: (id: string) => route(`/admin/posts/new?draft=${id}`),
    post: (id: string) => route(`/admin/posts/${id}`),
    postHistory: (id: string) => route(`/admin/posts/${id}/history`),
    postRevision: (id: string, selection: { page: number; revisionId: number }) =>
      route(`/admin/posts/${id}/history?${new URLSearchParams({ page: String(selection.page), revisionId: String(selection.revisionId) }).toString()}`),
    postExport: (id: string) => route(`/admin/posts/${id}/export`),
    mediaUpload: route('/api/admin/media'),
  },
}
