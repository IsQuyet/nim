import type { Route } from 'next'

// 地址由 app/ 的目录结构决定。这里的每个地址都经 Next 生成的路由类型校验，路由目录变动后不再存在的地址无法通过类型检查。
function route<T extends string>(path: Route<T>) {
  return path
}

// 正文里引用站内图片的地址以它开头，发布时据此识别媒体引用。
export const MEDIA_PATH_PREFIX = '/media/'

// 修订历史页上，选中修订的详情所在的页内锚点。
export const REVISION_DETAILS_ANCHOR = 'revision'

type RevisionSelection = { page: number; revisionId: number }

function revisionQuery({ page, revisionId }: RevisionSelection) {
  return new URLSearchParams({ page: String(page), revisionId: String(revisionId) }).toString()
}

function searchParamsQuery(query: string, scope: 'all' | 'posts' | 'gallery') {
  const params = new URLSearchParams()
  if (query.trim()) params.set('q', query.trim())
  if (scope !== 'all') params.set('type', scope)
  const serialized = params.toString()
  return serialized ? route(`/search?${serialized}`) : route('/search')
}

export const routes = {
  home: route('/'),
  blog: route('/blog'),
  post: (id: string) => route(`/blog/${id}`),
  gallery: route('/gallery'),
  galleryItem: (id: string) => route(`/gallery/${id}`),
  search: route('/search'),
  searchWith: searchParamsQuery,
  searchApi: route('/api/search'),
  media: (id: string) => route(`${MEDIA_PATH_PREFIX}${id}`),
  admin: {
    home: route('/admin'),
    gallery: route('/admin/gallery'),
    homepage: route('/admin/home'),
    media: route('/admin/media'),
    login: route('/admin/login'),
    import: route('/admin/import'),
    newPost: route('/admin/posts/new'),
    newDraft: (id: string) => route(`/admin/posts/new?draft=${id}`),
    post: (id: string) => route(`/admin/posts/${id}`),
    postHistory: (id: string) => route(`/admin/posts/${id}/history`),
    /** 修订列表的某一页，保持已选中的修订。 */
    postHistoryPage: (id: string, selection: RevisionSelection) =>
      route(`/admin/posts/${id}/history?${revisionQuery(selection)}`),
    /** 选中一条修订，并定位到它的详情。 */
    postRevision: (id: string, selection: RevisionSelection) =>
      route(`/admin/posts/${id}/history?${revisionQuery(selection)}#${REVISION_DETAILS_ANCHOR}`),
    postExport: (id: string) => route(`/admin/posts/${id}/export`),
    mediaUpload: route('/api/admin/media'),
  },
}
