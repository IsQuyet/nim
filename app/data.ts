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

type BlogPost = {
  title: string
  description: string
  link: string
  uid: string
}

type SocialLink = {
  label: string
  link: string
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

export const BLOG_POSTS: BlogPost[] = [
  {
    title: '为什么想找一款记账软件，最后却让我思考起了数据的开放？',
    description:
      '从寻找记账软件出发，思考个人财务数据的可携带性、授权访问，以及安全与开放之间的关系。',
    link: '/blog/financial-data-portability',
    uid: 'financial-data-portability',
  },
  {
    title: 'Exploring the Intersection of Design, AI, and Design Engineering',
    description: 'How AI is changing the way we design',
    link: '/blog/exploring-the-intersection-of-design-ai-and-design-engineering',
    uid: 'blog-1',
  },
  {
    title: 'How to Export Metadata from MDX for Next.js SEO',
    description: 'A guide on exporting metadata from MDX files to leverage Next.js SEO features.',
    link: '/blog/example-mdx-metadata',
    uid: 'blog-4',
  },
]

export const SOCIAL_LINKS: SocialLink[] = [
  {
    label: 'Github',
    link: 'https://github.com/ibelick',
  },
  {
    label: 'Twitter',
    link: 'https://twitter.com/ibelick',
  },
  {
    label: 'LinkedIn',
    link: 'https://www.linkedin.com/in/ibelick',
  },
  {
    label: 'Instagram',
    link: 'https://www.instagram.com/ibelick',
  },
]

export const EMAIL = 'your@email.com'
