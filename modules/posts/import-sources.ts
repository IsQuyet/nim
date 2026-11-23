type BlogPostSource = {
  id: string
  title: string
  description: string
  file: string
}

// 仅供显式导入使用，公开页面从数据库读取已发布内容。
export const BLOG_POST_SOURCES: BlogPostSource[] = [
  {
    id: '264efa5a-5f48-4f4d-bbc3-56021a5f6342',
    title: '为什么想找一款记账软件，最后却让我思考起了数据的开放？',
    description:
      '从寻找记账软件出发，思考个人财务数据的可携带性、授权访问，以及安全与开放之间的关系。',
    file: 'financial-data-portability.md',
  },
]
