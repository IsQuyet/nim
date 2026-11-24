import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { createGalleryStore } from '@/modules/gallery/server/store'
import { createPostStore } from '@/modules/posts/server/store'
import { PROJECTS, WORK_EXPERIENCE } from '../data'
import {
  HOME_FULL_WIDTH_SECTION_KEYS,
  HOME_SECTION_KEYS,
  type AdminHomeData,
  type AdminHomeItemSummary,
  type AdminHomeSectionState,
  type HomeCuratedItem,
  type HomeSectionConfig,
  type HomeSectionKey,
  type HomepageData,
  type HomepageFullWidthSection,
  type ParsedHomeConfigInput,
} from '../home-model'
import { siteHomeItems, siteHomeSections } from './schema'

const DEFAULT_SECTIONS: Record<HomeSectionKey, Omit<HomeSectionConfig, 'sectionKey'>> = {
  writing: {
    title: 'Recent writing',
    visible: true,
    sortOrder: 0,
    sourceMode: 'latest',
    maxItems: 4,
  },
  gallery: {
    title: 'Gallery',
    visible: true,
    sortOrder: 1,
    sourceMode: 'latest',
    maxItems: 6,
  },
  projects: {
    title: 'Selected projects',
    visible: true,
    sortOrder: 2,
    sourceMode: 'manual',
    maxItems: 6,
  },
  experience: {
    title: 'Work experience',
    visible: true,
    sortOrder: 3,
    sourceMode: 'manual',
    maxItems: 6,
  },
}

function defaultSection(sectionKey: HomeSectionKey): HomeSectionConfig {
  return { sectionKey, ...DEFAULT_SECTIONS[sectionKey] }
}

function readSections(database: AppDatabase): Map<HomeSectionKey, HomeSectionConfig> {
  const rows = database.select().from(siteHomeSections).all()
  const byKey = new Map<HomeSectionKey, HomeSectionConfig>()

  for (const key of HOME_SECTION_KEYS) {
    byKey.set(key, defaultSection(key))
  }
  for (const row of rows) {
    if (!HOME_SECTION_KEYS.includes(row.sectionKey as HomeSectionKey)) continue
    const key = row.sectionKey as HomeSectionKey
    byKey.set(key, {
      sectionKey: key,
      title: row.title,
      visible: row.visible,
      sortOrder: row.sortOrder,
      sourceMode: row.sourceMode,
      maxItems: row.maxItems,
    })
  }
  return byKey
}

function readItems(database: AppDatabase): Map<HomeSectionKey, HomeCuratedItem[]> {
  const rows = database
    .select()
    .from(siteHomeItems)
    .orderBy(asc(siteHomeItems.sortOrder), asc(siteHomeItems.id))
    .all()

  const grouped = new Map<HomeSectionKey, HomeCuratedItem[]>()
  for (const key of HOME_SECTION_KEYS) grouped.set(key, [])

  for (const row of rows) {
    if (!HOME_SECTION_KEYS.includes(row.sectionKey as HomeSectionKey)) continue
    const key = row.sectionKey as HomeSectionKey
    grouped.get(key)!.push({
      sectionKey: key,
      itemKind: row.itemKind,
      itemId: row.itemId,
      visible: row.visible,
      sortOrder: row.sortOrder,
    })
  }
  return grouped
}

function resolveStaticEntries<T extends { id: string }>(
  entries: readonly T[],
  curated: HomeCuratedItem[],
): Array<{ entry: T; visible: boolean }> {
  if (curated.length === 0) {
    return entries.map(entry => ({ entry, visible: true }))
  }

  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const resolved: Array<{ entry: T; visible: boolean }> = []
  const seen = new Set<string>()

  for (const item of curated) {
    const entry = byId.get(item.itemId)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    resolved.push({ entry, visible: item.visible })
  }

  for (const entry of entries) {
    if (!seen.has(entry.id)) {
      resolved.push({ entry, visible: true })
    }
  }

  return resolved
}

export type HomeStore = {
  getPublicHomepage(): HomepageData
  getAdminHomepage(): AdminHomeData
  saveConfig(input: ParsedHomeConfigInput): void
}

export function createHomeStore(database: AppDatabase): HomeStore {
  function getPublicHomepage(): HomepageData {
    const sections = readSections(database)
    const curatedBySection = readItems(database)
    const publishedPosts = createPostStore(database).listPublishedPosts()
    const publishedGallery = createGalleryStore(database).listPublished()

    const postsById = new Map(publishedPosts.map(post => [post.id, post]))
    const galleryById = new Map(publishedGallery.map(item => [item.id, item]))

    const writingConfig = sections.get('writing')! as HomeSectionConfig & { sectionKey: 'writing' }
    const writingPosts = !writingConfig.visible
      ? []
      : writingConfig.sourceMode === 'latest'
        ? publishedPosts.slice(0, writingConfig.maxItems)
        : (curatedBySection.get('writing') ?? [])
            .filter(item => item.visible)
            .map(item => postsById.get(item.itemId))
            .filter((post): post is NonNullable<typeof post> => post !== undefined)
            .slice(0, writingConfig.maxItems)

    const orderedFullWidth = [...HOME_FULL_WIDTH_SECTION_KEYS]
      .map(key => sections.get(key)!)
      .sort((left, right) => left.sortOrder - right.sortOrder)

    const fullWidthSections: HomepageFullWidthSection[] = []

    for (const config of orderedFullWidth) {
      if (!config.visible) continue

      if (config.sectionKey === 'gallery') {
        const items = config.sourceMode === 'latest'
          ? publishedGallery.slice(0, config.maxItems)
          : (curatedBySection.get('gallery') ?? [])
              .filter(item => item.visible)
              .map(item => galleryById.get(item.itemId))
              .filter((item): item is NonNullable<typeof item> => item !== undefined)
              .slice(0, config.maxItems)
        if (items.length > 0) {
          fullWidthSections.push({
            kind: 'gallery',
            section: config as HomeSectionConfig & { sectionKey: 'gallery' },
            items,
          })
        }
      } else if (config.sectionKey === 'projects') {
        const items = resolveStaticEntries(PROJECTS, curatedBySection.get('projects') ?? [])
          .filter(entry => entry.visible)
          .map(entry => entry.entry)
          .slice(0, config.maxItems)
        if (items.length > 0) {
          fullWidthSections.push({
            kind: 'projects',
            section: config as HomeSectionConfig & { sectionKey: 'projects' },
            items,
          })
        }
      } else if (config.sectionKey === 'experience') {
        const items = resolveStaticEntries(WORK_EXPERIENCE, curatedBySection.get('experience') ?? [])
          .filter(entry => entry.visible)
          .map(entry => entry.entry)
          .slice(0, config.maxItems)
        if (items.length > 0) {
          fullWidthSections.push({
            kind: 'experience',
            section: config as HomeSectionConfig & { sectionKey: 'experience' },
            items,
          })
        }
      }
    }

    return {
      writing: { section: writingConfig, posts: writingPosts },
      sections: fullWidthSections,
    }
  }

  function getAdminHomepage(): AdminHomeData {
    const sections = readSections(database)
    const curatedBySection = readItems(database)
    const publishedPosts = createPostStore(database).listPublishedPosts()
    const publishedGallery = createGalleryStore(database).listPublished()
    const allGallery = createGalleryStore(database).listAll()

    const postsById = new Map(publishedPosts.map(post => [post.id, post]))
    const publishedGalleryById = new Map(publishedGallery.map(item => [item.id, item]))
    const anyGalleryById = new Map(allGallery.map(item => [item.id, item]))

    const orderedSections = [
      sections.get('writing')!,
      ...[...HOME_FULL_WIDTH_SECTION_KEYS]
        .map(key => sections.get(key)!)
        .sort((left, right) => left.sortOrder - right.sortOrder),
    ]

    const resolvedSections: AdminHomeSectionState[] = orderedSections.map(config => {
      const curated = curatedBySection.get(config.sectionKey) ?? []

      let items: AdminHomeItemSummary[] = []
      if (config.sectionKey === 'writing') {
        items = curated.map(item => {
          const post = postsById.get(item.itemId)
          return {
            itemKind: 'post',
            itemId: item.itemId,
            label: post?.title ?? `Unavailable post (${item.itemId.slice(0, 8)})`,
            subtitle: post ? 'Published post' : 'Not currently published',
            visible: item.visible,
            available: post !== undefined,
          }
        })
      } else if (config.sectionKey === 'gallery') {
        items = curated.map(item => {
          const published = publishedGalleryById.get(item.itemId)
          const any = anyGalleryById.get(item.itemId)
          return {
            itemKind: 'gallery',
            itemId: item.itemId,
            label: published?.title ?? any?.title ?? `Missing photo (${item.itemId.slice(0, 8)})`,
            subtitle: published
              ? 'Published photo'
              : any
                ? 'Draft only (hidden on homepage until published)'
                : 'Removed from gallery',
            visible: item.visible,
            available: published !== undefined,
          }
        })
      } else if (config.sectionKey === 'projects') {
        items = resolveStaticEntries(PROJECTS, curated).map(({ entry, visible }) => ({
          itemKind: 'project',
          itemId: entry.id,
          label: entry.name,
          subtitle: entry.description,
          visible,
          available: true,
        }))
      } else {
        items = resolveStaticEntries(WORK_EXPERIENCE, curated).map(({ entry, visible }) => ({
          itemKind: 'experience',
          itemId: entry.id,
          label: `${entry.title} · ${entry.company}`,
          subtitle: `${entry.start} - ${entry.end}`,
          visible,
          available: true,
        }))
      }

      return { ...config, items }
    })

    return {
      sections: resolvedSections,
      availablePosts: publishedPosts.map(post => ({
        id: post.id,
        title: post.title,
        publishedAt: post.publishedAt,
      })),
      availableGallery: publishedGallery.map(item => ({
        id: item.id,
        title: item.title,
        publishedAt: item.publishedAt,
        mediaId: item.mediaId,
      })),
    }
  }

  function saveConfig(input: ParsedHomeConfigInput) {
    database.transaction(transaction => {
      const now = new Date().toISOString()
      for (const section of input.sections) {
        transaction
          .insert(siteHomeSections)
          .values({
            sectionKey: section.sectionKey,
            title: section.title,
            visible: section.visible,
            sortOrder: section.sortOrder,
            sourceMode: section.sourceMode,
            maxItems: section.maxItems,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: siteHomeSections.sectionKey,
            set: {
              title: section.title,
              visible: section.visible,
              sortOrder: section.sortOrder,
              sourceMode: section.sourceMode,
              maxItems: section.maxItems,
              updatedAt: now,
            },
          })
          .run()

        transaction.delete(siteHomeItems).where(eq(siteHomeItems.sectionKey, section.sectionKey)).run()
        section.items.forEach((item, index) => {
          transaction
            .insert(siteHomeItems)
            .values({
              sectionKey: section.sectionKey,
              itemKind: item.itemKind,
              itemId: item.itemId,
              visible: item.visible,
              sortOrder: index,
            })
            .run()
        })
      }
    }, { behavior: 'immediate' })
  }

  return { getPublicHomepage, getAdminHomepage, saveConfig }
}
