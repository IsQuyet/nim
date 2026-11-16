'use client'

import { samePostContent, type PostContent, type PublishedPost } from '@/lib/content'
import { MarkdownPreviewLoader } from '@/components/markdown-preview-loader'
import { MarkdownProse } from '@/components/markdown-prose'

type ComparedVersion = PostContent & {
  label: string
  revisionId: number | null
  detail?: string
}

type MarkdownComparisonProps = {
  published: PublishedPost | null
  compared: ComparedVersion
}

function VersionPanel({
  label,
  revisionId,
  detail,
  title,
  description,
  body,
}: ComparedVersion) {
  return (
    <article aria-label={label} className="min-w-0 space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <header className="space-y-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h3 className="font-medium">{label}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {revisionId === null ? 'Not saved to a revision' : `Revision ${revisionId}`}
          {detail ? ` · ${detail}` : ''}
        </p>
      </header>
      <section aria-label={`${label} title`} className="space-y-1">
        <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Title</h4>
        <p>{title || 'Untitled'}</p>
      </section>
      <section aria-label={`${label} summary`} className="space-y-1">
        <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Summary</h4>
        {description ? <p>{description}</p> : <p className="text-zinc-500 dark:text-zinc-400">No summary.</p>}
      </section>
      <section aria-label={`${label} body`} className="space-y-1">
        <h4 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Body</h4>
        <MarkdownProse className="max-w-none">
          {body ? <MarkdownPreviewLoader source={body} /> : <p>Nothing in the body.</p>}
        </MarkdownProse>
      </section>
    </article>
  )
}

export function MarkdownComparison({ published, compared }: MarkdownComparisonProps) {
  const identical = published !== null && samePostContent(published, compared)

  return (
    <section aria-label="Rendered version comparison" className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-medium">Published comparison</h2>
        {published ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Published revision {published.revisionId} · Publication {published.publicationId}
          </p>
        ) : (
          <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
            This post has not been published yet.
          </p>
        )}
        {identical && <p role="status" className="text-sm">These versions have no content differences.</p>}
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        {published && (
          <VersionPanel
            label="Published version"
            revisionId={published.revisionId}
            detail={`Publication ${published.publicationId}`}
            title={published.title}
            description={published.description}
            body={published.body}
          />
        )}
        <VersionPanel {...compared} />
      </div>
    </section>
  )
}
