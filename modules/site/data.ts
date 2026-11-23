type Site = {
  name: string
  description: string
}

type Profile = {
  name: string
  role: string
  description: string
}

type Project = {
  name: string
  description: string
  link: string
  video: string
  id: string
}

type WorkExperience = {
  company: string
  title: string
  start: string
  end: string
  link: string
  id: string
}

type BlogPostSource = {
  id: string
  title: string
  description: string
  file: string
}

type SocialLink = {
  label: string
  link: string
}

export const SITE: Site = {
  name: 'Site name',
  description: 'A short description of this site.',
}

export const PROFILE: Profile = {
  name: 'Your name',
  role: 'Your role',
  description: 'A short introduction about you.',
}

export const PROJECTS: Project[] = [
  {
    name: 'Project name',
    description: 'A short description of your project.',
    link: 'https://example.com',
    video: '',
    id: 'project-placeholder',
  },
]

export const WORK_EXPERIENCE: WorkExperience[] = [
  {
    company: 'Company name',
    title: 'Role',
    start: 'Start year',
    end: 'End year',
    link: 'https://example.com',
    id: 'work-placeholder',
  },
]

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

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: 'Social profile',
    link: 'https://example.com',
  },
]

export const EMAIL = 'your@email.com'
