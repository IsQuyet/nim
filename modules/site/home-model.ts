import { z } from 'zod'
import type { PublishedGalleryItem } from '@/modules/gallery/model'
import type { PublishedPostSummary } from '@/modules/posts/model'
import type { PROJECTS, WORK_EXPERIENCE } from './data'

export const HOME_SECTION_KEYS = ['writing', 'gallery', 'projects', 'experience'] as const
export type HomeSectionKey = (typeof HOME_SECTION_KEYS)[number]

export const HOME_FULL_WIDTH_SECTION_KEYS = ['gallery', 'projects', 'experience'] as const
export type HomeFullWidthSectionKey = (typeof HOME_FULL_WIDTH_SECTION_KEYS)[number]

export const homeSectionKeySchema = z.enum(HOME_SECTION_KEYS)
export const homeSourceModeSchema = z.enum(['latest', 'manual'])
export type HomeSourceMode = z.infer<typeof homeSourceModeSchema>

export const homeItemKindSchema = z.enum(['post', 'gallery', 'project', 'experience'])
export type HomeItemKind = z.infer<typeof homeItemKindSchema>

export type HomeSectionConfig = {
  sectionKey: HomeSectionKey
  title: string
  visible: boolean
  sortOrder: number
  sourceMode: HomeSourceMode
  maxItems: number
}

export type HomeCuratedItem = {
  sectionKey: HomeSectionKey
  itemKind: HomeItemKind
  itemId: string
  visible: boolean
  sortOrder: number
}

export const saveHomeItemSchema = z.object({
  itemKind: homeItemKindSchema,
  itemId: z.string().trim().min(1).max(200),
  visible: z.boolean(),
}).strict()

export const saveHomeSectionSchema = z.object({
  sectionKey: homeSectionKeySchema,
  title: z.string().trim().min(1, { error: 'Enter a section title.' }).max(80),
  visible: z.boolean(),
  sortOrder: z.number().int().min(0).max(20),
  sourceMode: homeSourceModeSchema,
  maxItems: z.number().int().min(1).max(12),
  items: z.array(saveHomeItemSchema).max(50),
}).strict()

export const saveHomeConfigSchema = z.object({
  sections: z.array(saveHomeSectionSchema).length(HOME_SECTION_KEYS.length),
}).strict().superRefine((value, context) => {
  const seenSections = new Set<HomeSectionKey>()
  for (const section of value.sections) {
    if (seenSections.has(section.sectionKey)) {
      context.addIssue({ code: 'custom', path: ['sections'], message: 'Duplicate homepage section key.' })
      return
    }
    seenSections.add(section.sectionKey)

    const seenItems = new Set<string>()
    for (const item of section.items) {
      const expectedKind = expectedKindForSection(section.sectionKey)
      if (item.itemKind !== expectedKind) {
        context.addIssue({ code: 'custom', path: ['sections'], message: `Invalid item kind for ${section.sectionKey}.` })
        return
      }
      if (seenItems.has(item.itemId)) {
        context.addIssue({ code: 'custom', path: ['sections'], message: `Duplicate item in ${section.sectionKey}.` })
        return
      }
      seenItems.add(item.itemId)
    }
  }
})

export type SaveHomeConfigInput = z.input<typeof saveHomeConfigSchema>
export type ParsedHomeConfigInput = z.output<typeof saveHomeConfigSchema>

export function expectedKindForSection(sectionKey: HomeSectionKey): HomeItemKind {
  switch (sectionKey) {
    case 'writing':
      return 'post'
    case 'gallery':
      return 'gallery'
    case 'projects':
      return 'project'
    case 'experience':
      return 'experience'
  }
}

export type ProjectEntry = (typeof PROJECTS)[number]
export type WorkExperienceEntry = (typeof WORK_EXPERIENCE)[number]

export type HomepageFullWidthSection =
  | { kind: 'gallery'; section: HomeSectionConfig & { sectionKey: 'gallery' }; items: PublishedGalleryItem[] }
  | { kind: 'projects'; section: HomeSectionConfig & { sectionKey: 'projects' }; items: ProjectEntry[] }
  | { kind: 'experience'; section: HomeSectionConfig & { sectionKey: 'experience' }; items: WorkExperienceEntry[] }

export type HomepageData = {
  writing: {
    section: HomeSectionConfig & { sectionKey: 'writing' }
    posts: PublishedPostSummary[]
  }
  sections: HomepageFullWidthSection[]
}

export type AdminHomeItemSummary = {
  itemKind: HomeItemKind
  itemId: string
  label: string
  subtitle: string
  visible: boolean
  available: boolean
}

export type AdminHomeSectionState = HomeSectionConfig & {
  items: AdminHomeItemSummary[]
}

export type AdminHomeData = {
  sections: AdminHomeSectionState[]
  availablePosts: Array<{ id: string; title: string; publishedAt: string }>
  availableGallery: Array<{ id: string; title: string; publishedAt: string; mediaId: string }>
}
