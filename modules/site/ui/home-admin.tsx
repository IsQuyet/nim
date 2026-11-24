'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { routes } from '@/lib/routes'
import {
  expectedKindForSection,
  type AdminHomeData,
  type AdminHomeItemSummary,
  type AdminHomeSectionState,
  type HomeSectionKey,
  type HomeSourceMode,
} from '../home-model'
import { saveHomeConfigAction } from '../server/actions/home'

const SECTION_HINTS: Record<HomeSectionKey, string> = {
  writing: 'Shown beside your profile introduction at the top of the homepage.',
  gallery: 'Shown as a 3-column showcase strip linking to /gallery and the lightbox.',
  projects: 'Shows project entries from your site catalog with individual visibility and order.',
  experience: 'Shows work experience entries from your site catalog with individual visibility and order.',
}

function moveEntry<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

export function HomeAdmin({ initial }: { initial: AdminHomeData }) {
  const router = useRouter()
  const [sections, setSections] = useState<AdminHomeSectionState[]>(initial.sections)
  const [selectedAddIds, setSelectedAddIds] = useState<Partial<Record<'writing' | 'gallery', string>>>({})
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{
    status: 'success' | 'error'
    message: string
    signInRequired?: boolean
  } | null>(null)

  const writingSection = sections.find(section => section.sectionKey === 'writing')!
  const fullWidthSections = sections.filter(section => section.sectionKey !== 'writing')

  function updateSection(sectionKey: HomeSectionKey, updater: (section: AdminHomeSectionState) => AdminHomeSectionState) {
    setSections(previous => previous.map(section => (
      section.sectionKey === sectionKey ? updater(section) : section
    )))
    setFeedback(null)
  }

  function moveFullWidthSection(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= fullWidthSections.length) return
    const reordered = moveEntry(fullWidthSections, index, direction)
    setSections([writingSection, ...reordered])
    setFeedback(null)
  }

  function addDynamicItem(sectionKey: 'writing' | 'gallery') {
    const section = sections.find(entry => entry.sectionKey === sectionKey)
    if (!section) return

    const existingIds = new Set(section.items.map(item => item.itemId))
    const pool = sectionKey === 'writing' ? initial.availablePosts : initial.availableGallery
    const chosenId = selectedAddIds[sectionKey] || pool.find(entry => !existingIds.has(entry.id))?.id
    if (!chosenId || existingIds.has(chosenId)) return

    const entry = pool.find(item => item.id === chosenId)
    if (!entry) return

    const newItem: AdminHomeItemSummary = {
      itemKind: expectedKindForSection(sectionKey),
      itemId: entry.id,
      label: entry.title,
      subtitle: sectionKey === 'writing' ? 'Published post' : 'Published photo',
      visible: true,
      available: true,
    }

    updateSection(sectionKey, current => ({
      ...current,
      items: [...current.items, newItem],
    }))
    setSelectedAddIds(previous => ({ ...previous, [sectionKey]: '' }))
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setFeedback(null)
    try {
      const normalized = [writingSection, ...fullWidthSections].map((section, index) => ({
        sectionKey: section.sectionKey,
        title: section.title,
        visible: section.visible,
        sortOrder: index,
        sourceMode: section.sourceMode,
        maxItems: Number.isFinite(section.maxItems) ? Math.min(12, Math.max(1, section.maxItems)) : 4,
        items: section.items.map(item => ({
          itemKind: item.itemKind,
          itemId: item.itemId,
          visible: item.visible,
        })),
      }))
      const result = await saveHomeConfigAction({ sections: normalized })
      if (result.status === 'success') {
        setFeedback({ status: 'success', message: 'Homepage settings saved.' })
        router.refresh()
      } else {
        setFeedback({
          status: 'error',
          message: result.message,
          signInRequired: 'signInRequired' in result ? result.signInRequired : undefined,
        })
      }
    } catch {
      setFeedback({ status: 'error', message: 'Could not save homepage settings. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  function renderSectionCard(section: AdminHomeSectionState, fullWidthIndex?: number) {
    const isDynamic = section.sectionKey === 'writing' || section.sectionKey === 'gallery'
    const existingIds = new Set(section.items.map(item => item.itemId))
    const availablePool = section.sectionKey === 'writing'
      ? initial.availablePosts.filter(post => !existingIds.has(post.id))
      : section.sectionKey === 'gallery'
        ? initial.availableGallery.filter(photo => !existingIds.has(photo.id))
        : []
    const currentAddId = (section.sectionKey === 'writing' || section.sectionKey === 'gallery')
      ? (selectedAddIds[section.sectionKey] || availablePool[0]?.id || '')
      : ''

    return (
      <section
        key={section.sectionKey}
        aria-labelledby={`home-section-${section.sectionKey}`}
        className="space-y-4 rounded-xl border border-border p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id={`home-section-${section.sectionKey}`} className="text-lg font-medium capitalize">
                {section.sectionKey}
              </h2>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={section.visible}
                  onChange={event => updateSection(section.sectionKey, current => ({
                    ...current,
                    visible: event.target.checked,
                  }))}
                />
                Show on homepage
              </label>
            </div>
            <p className="text-sm text-muted-foreground">{SECTION_HINTS[section.sectionKey]}</p>
          </div>

          {typeof fullWidthIndex === 'number' && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${section.sectionKey} section up`}
                disabled={fullWidthIndex === 0}
                onClick={() => moveFullWidthSection(fullWidthIndex, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Move ${section.sectionKey} section down`}
                disabled={fullWidthIndex === fullWidthSections.length - 1}
                onClick={() => moveFullWidthSection(fullWidthIndex, 1)}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
          <div className="space-y-1.5 sm:col-span-6">
            <Label htmlFor={`home-title-${section.sectionKey}`}>Heading</Label>
            <Input
              id={`home-title-${section.sectionKey}`}
              value={section.title}
              onChange={event => updateSection(section.sectionKey, current => ({
                ...current,
                title: event.target.value,
              }))}
            />
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor={`home-max-${section.sectionKey}`}>Max items</Label>
            <Input
              id={`home-max-${section.sectionKey}`}
              type="number"
              min={1}
              max={12}
              value={section.maxItems}
              onChange={event => {
                const value = Number.parseInt(event.target.value, 10)
                updateSection(section.sectionKey, current => ({
                  ...current,
                  maxItems: Number.isNaN(value) ? 1 : Math.min(12, Math.max(1, value)),
                }))
              }}
            />
          </div>

          {isDynamic && (
            <div className="space-y-1.5 sm:col-span-4">
              <Label htmlFor={`home-mode-${section.sectionKey}`}>Selection mode</Label>
              <select
                id={`home-mode-${section.sectionKey}`}
                value={section.sourceMode}
                onChange={event => updateSection(section.sectionKey, current => ({
                  ...current,
                  sourceMode: event.target.value as HomeSourceMode,
                }))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-offset-2 outline-ring focus-visible:outline-2"
              >
                <option value="latest">Latest published automatically</option>
                <option value="manual">Manual curated list only</option>
              </select>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {isDynamic ? 'Curated entries' : 'Entries'} ({section.items.length})
            </p>
            {isDynamic && section.sourceMode === 'latest' && (
              <p className="text-xs text-muted-foreground">
                Currently showing latest {section.maxItems} published items; switch mode to “Manual curated list only” to use the picks below.
              </p>
            )}
          </div>

          {section.items.length > 0 ? (
            <ul aria-label={`${section.sectionKey} homepage entries`} className="divide-y divide-border rounded-lg border">
              {section.items.map((item, itemIndex) => (
                <li key={item.itemId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.label}</span>
                      {!item.available && (
                        <span className="shrink-0 text-xs text-destructive">Unpublished</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={item.visible}
                        onChange={event => updateSection(section.sectionKey, current => ({
                          ...current,
                          items: current.items.map(entry => (
                            entry.itemId === item.itemId ? { ...entry, visible: event.target.checked } : entry
                          )),
                        }))}
                      />
                      Show
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${item.label} up`}
                      disabled={itemIndex === 0}
                      onClick={() => updateSection(section.sectionKey, current => ({
                        ...current,
                        items: moveEntry(current.items, itemIndex, -1),
                      }))}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${item.label} down`}
                      disabled={itemIndex === section.items.length - 1}
                      onClick={() => updateSection(section.sectionKey, current => ({
                        ...current,
                        items: moveEntry(current.items, itemIndex, 1),
                      }))}
                    >
                      <ArrowDownIcon />
                    </Button>
                    {isDynamic && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${item.label}`}
                        onClick={() => updateSection(section.sectionKey, current => ({
                          ...current,
                          items: current.items.filter(entry => entry.itemId !== item.itemId),
                        }))}
                      >
                        <Trash2Icon />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isDynamic ? 'No manual entries added yet.' : 'No entries found in site data.'}
            </p>
          )}

          {isDynamic && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <select
                aria-label={`Choose ${section.sectionKey} entry to add`}
                value={currentAddId}
                disabled={availablePool.length === 0}
                onChange={event => setSelectedAddIds(previous => ({
                  ...previous,
                  [section.sectionKey]: event.target.value,
                }))}
                className="min-w-56 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-offset-2 outline-ring focus-visible:outline-2 disabled:opacity-60"
              >
                {availablePool.length === 0 ? (
                  <option value="">No more published items to add</option>
                ) : (
                  availablePool.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))
                )}
              </select>
              <Button
                type="button"
                variant="outline"
                disabled={!currentAddId}
                onClick={() => addDynamicItem(section.sectionKey as 'writing' | 'gallery')}
              >
                <PlusIcon />
                Add entry
              </Button>
            </div>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-6">
        {renderSectionCard(writingSection)}
        {fullWidthSections.map((section, index) => renderSectionCard(section, index))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <div className="space-y-1 text-sm">
          {feedback && (
            <div
              role={feedback.status === 'error' ? 'alert' : 'status'}
              className={feedback.status === 'error' ? 'text-destructive' : 'text-foreground'}
            >
              <p>{feedback.message}</p>
              {feedback.signInRequired && (
                <a href={routes.admin.login} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  Sign in in a new tab
                </a>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline">
            <Link href={routes.home}>View homepage</Link>
          </Button>
          <Button type="button" disabled={saving} onClick={() => { void handleSave() }}>
            {saving ? 'Saving…' : 'Save homepage'}
          </Button>
        </div>
      </div>
    </div>
  )
}
