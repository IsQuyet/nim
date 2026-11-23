import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MarkdownComparison } from '@/modules/posts/ui/version-comparison'
import { getAdminRevisionHistory } from '@/modules/posts/server/admin'
import type { PostRevisionSummary } from '@/modules/posts/history'
import { samePostContent } from '@/modules/posts/model'
import { restoreRevisionAction } from '@/modules/posts/server/actions/history'
import { RestoreForm } from '@/modules/posts/ui/restore-form'
import { routes } from '@/lib/routes'
import { Focus } from '@/components/layout/focus'

export const metadata: Metadata = { title: 'Revision history' }

type RevisionHistoryPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const sourceLabels = {
  create: 'Created',
  save: 'Saved',
  publish: 'Published',
  import: 'Imported',
  restore: 'Restored',
  migration: 'Migrated',
} satisfies Record<PostRevisionSummary['source'], string>

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'medium',
  timeZone: 'UTC',
})

function revisionHref(id: string, page: number, revisionId: number) {
  return routes.admin.postRevision(id, { page, revisionId })
}

function RevisionMarkers({
  revisionId,
  draftRevisionId,
  publishedRevisionId,
}: {
  revisionId: number
  draftRevisionId: number
  publishedRevisionId: number | undefined
}) {
  return (
    <>
      {revisionId === draftRevisionId && <span>Last saved revision</span>}
      {revisionId === publishedRevisionId && <span>Currently published</span>}
    </>
  )
}

export default async function RevisionHistoryPage({ params, searchParams }: RevisionHistoryPageProps) {
  const { id } = await params
  const history = await getAdminRevisionHistory(id, await searchParams)
  if (!history) notFound()
  const { draft, published, selectedRevision, revisions, page, pageCount, revisionCount } = history

  return (
    <Focus>
      <main className="space-y-8">
        <section className="space-y-3">
          <Link
            href={routes.admin.post(id)}
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Back to editor
          </Link>
          <h1 className="text-lg font-medium">Revision history</h1>
          <p className="text-muted-foreground">
            {revisionCount} {revisionCount === 1 ? 'revision' : 'revisions'}. Restoring changes only the draft.
          </p>
        </section>
        <ol aria-label="Revisions" className="divide-y divide-border">
          {revisions.map(revision => (
            <li key={revision.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <Link
                href={revisionHref(id, page, revision.id)}
                aria-current={selectedRevision.id === revision.id ? 'true' : undefined}
                className="font-medium underline underline-offset-4 transition-colors hover:text-muted-foreground"
              >
                {revision.title}
              </Link>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Revision {revision.id}</span>
                <time dateTime={revision.createdAt}>
                  {dateFormatter.format(new Date(revision.createdAt))} UTC
                </time>
                <span>{sourceLabels[revision.source]}</span>
                <RevisionMarkers
                  revisionId={revision.id}
                  draftRevisionId={draft.revisionId}
                  publishedRevisionId={published?.revisionId}
                />
                {revision.restoredFromRevisionId !== null && (
                  <Link
                    href={revisionHref(id, page, revision.restoredFromRevisionId)}
                    className="underline underline-offset-4"
                  >
                    Restored from revision {revision.restoredFromRevisionId}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
        <nav aria-label="Revision pages" className="flex flex-wrap items-center justify-between gap-4 text-sm">
          {page > 1 && (
            <Link href={revisionHref(id, page - 1, selectedRevision.id)} className="underline underline-offset-4">
              Previous page
            </Link>
          )}
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          {page < pageCount && (
            <Link href={revisionHref(id, page + 1, selectedRevision.id)} className="underline underline-offset-4">
              Next page
            </Link>
          )}
        </nav>
        <section aria-label="Revision details" className="space-y-4 border-t border-border pt-6">
          <h2 className="text-lg font-medium">{selectedRevision.title}</h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Revision {selectedRevision.id}</span>
            <time dateTime={selectedRevision.createdAt}>
              {dateFormatter.format(new Date(selectedRevision.createdAt))} UTC
            </time>
            <span>{sourceLabels[selectedRevision.source]}</span>
            <RevisionMarkers
              revisionId={selectedRevision.id}
              draftRevisionId={draft.revisionId}
              publishedRevisionId={published?.revisionId}
            />
            {selectedRevision.restoredFromRevisionId !== null && (
              <Link
                href={revisionHref(id, page, selectedRevision.restoredFromRevisionId)}
                className="underline underline-offset-4"
              >
                Restored from revision {selectedRevision.restoredFromRevisionId}
              </Link>
            )}
          </div>
          {selectedRevision.description && (
            <p className="text-muted-foreground">{selectedRevision.description}</p>
          )}
          <RestoreForm
            key={`${selectedRevision.id}:${draft.revisionId}`}
            action={restoreRevisionAction.bind(null, id, {
              revisionId: selectedRevision.id,
              expectedRevisionId: draft.revisionId,
            })}
            disabled={samePostContent(selectedRevision, draft)}
          />
          <MarkdownComparison
            published={published}
            compared={{
              label: 'Selected revision',
              revisionId: selectedRevision.id,
              detail: `${sourceLabels[selectedRevision.source]} · ${dateFormatter.format(new Date(selectedRevision.createdAt))} UTC`,
              title: selectedRevision.title,
              description: selectedRevision.description,
              body: selectedRevision.body,
            }}
          />
        </section>
      </main>
    </Focus>
  )
}
