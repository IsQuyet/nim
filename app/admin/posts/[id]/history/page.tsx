import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { Panes } from '@/components/layout/panes'
import { MarkdownComparison } from '@/modules/posts/ui/version-comparison'
import { getAdminRevisionHistory } from '@/modules/posts/server/admin'
import type { PostRevisionHistory, PostRevisionSummary } from '@/modules/posts/history'
import { samePostContent } from '@/modules/posts/model'
import { restoreRevisionAction } from '@/modules/posts/server/actions/history'
import { RestoreForm } from '@/modules/posts/ui/restore-form'
import { REVISION_DETAILS_ANCHOR, routes } from '@/lib/routes'
import { cn } from '@/lib/utils'

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

const pageLinkClassName = 'underline underline-offset-4 transition-colors hover:text-muted-foreground'

/** 一条修订的编号、时间、来源，以及它与草稿、发布版的关系。 */
function RevisionFacts({ revision, history, className }: {
  revision: PostRevisionSummary
  history: PostRevisionHistory
  className: string
}) {
  const { draft, published, page } = history

  return (
    <div className={cn('flex flex-wrap text-xs text-muted-foreground', className)}>
      <span>Revision {revision.id}</span>
      <time dateTime={revision.createdAt}>
        {dateFormatter.format(new Date(revision.createdAt))} UTC
      </time>
      <span>{sourceLabels[revision.source]}</span>
      {revision.id === draft.revisionId && <span className="text-foreground">Last saved revision</span>}
      {revision.id === published?.revisionId && <span className="text-foreground">Currently published</span>}
      {revision.restoredFromRevisionId !== null && (
        <Link
          href={routes.admin.postRevision(draft.id, { page, revisionId: revision.restoredFromRevisionId })}
          className="underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Restored from revision {revision.restoredFromRevisionId}
        </Link>
      )}
    </div>
  )
}

export default async function RevisionHistoryPage({ params, searchParams }: RevisionHistoryPageProps) {
  const { id } = await params
  const history = await getAdminRevisionHistory(id, await searchParams)
  if (!history) notFound()
  const { draft, published, selectedRevision, revisions, page, pageCount, revisionCount } = history

  return (
    <Canvas>
      <main>
        <Panes
          split="list-detail"
          side={
            <>
              <PageHeader
                title="Revision history"
                back={{ href: routes.admin.post(id), label: 'Back to editor' }}
                description={
                  <p>
                    {revisionCount} {revisionCount === 1 ? 'revision' : 'revisions'}. Restoring changes only the draft.
                  </p>
                }
              />
              <div className="space-y-6 md:min-h-0 md:overflow-y-auto md:pr-1">
                <ol aria-label="Revisions" className="border-l">
                  {revisions.map(revision => {
                    const selected = selectedRevision.id === revision.id

                    return (
                      <li
                        key={revision.id}
                        className={cn('-ml-px space-y-1 border-l-2 py-2.5 pl-4', selected ? 'border-foreground' : 'border-transparent')}
                      >
                        <Link
                          href={routes.admin.postRevision(id, { page, revisionId: revision.id })}
                          aria-current={selected ? 'true' : undefined}
                          className={cn(
                            'block w-fit font-medium transition-colors hover:text-foreground',
                            selected ? 'text-foreground' : 'text-muted-foreground',
                          )}
                        >
                          {revision.title}
                        </Link>
                        <RevisionFacts revision={revision} history={history} className="gap-x-3 gap-y-0.5" />
                      </li>
                    )
                  })}
                </ol>
                <nav aria-label="Revision pages" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                  {page > 1 && (
                    <Link href={routes.admin.postHistoryPage(id, { page: page - 1, revisionId: selectedRevision.id })} className={pageLinkClassName}>
                      Previous page
                    </Link>
                  )}
                  <span className="text-muted-foreground">Page {page} of {pageCount}</span>
                  {page < pageCount && (
                    <Link href={routes.admin.postHistoryPage(id, { page: page + 1, revisionId: selectedRevision.id })} className={pageLinkClassName}>
                      Next page
                    </Link>
                  )}
                </nav>
              </div>
            </>
          }
        >
          {/* 两栏并排时详情与列表同起于画布顶边，选中后页面回到顶端。上下排列时详情在列表之后，选中后滚到详情。 */}
          <section
            id={REVISION_DETAILS_ANCHOR}
            aria-label="Revision details"
            className="scroll-mt-(--anchor-top) space-y-8 border-t pt-10 md:scroll-mt-(--canvas-top) md:border-t-0 md:pt-0"
          >
            <header className="space-y-2">
              <h2 className="text-xl font-medium">{selectedRevision.title}</h2>
              <RevisionFacts revision={selectedRevision} history={history} className="gap-x-4 gap-y-1" />
              {selectedRevision.description && (
                <p className="text-muted-foreground">{selectedRevision.description}</p>
              )}
            </header>
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
        </Panes>
      </main>
    </Canvas>
  )
}
