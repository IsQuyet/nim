import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminSession } from '@/modules/auth/server/auth'
import { importMarkdownAction } from './actions'
import { ImportForm } from './import-form'

export const metadata: Metadata = { title: 'Import Markdown' }

const example = '---\ntitle: Imported draft\n---\n\n# Markdown body\n'

export default async function ImportPage() {
  await requireAdminSession()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <Link href="/admin" className="text-sm text-zinc-500 underline underline-offset-4 dark:text-zinc-400">
          Back to posts
        </Link>
        <h1 className="text-lg font-medium">Import Markdown</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          YAML front matter must include title. Description is optional and defaults to an empty string. The id field is optional.
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          Only the id field selects an existing article, never the filename. Importing completely replaces its draft without publishing.
        </p>
        <p className="text-zinc-600 dark:text-zinc-400">
          Without an id, this import attempt creates a new draft. Retrying the same file reuses it. The UTF-8 Markdown body is preserved exactly.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-sm dark:bg-zinc-900"><code>{example}</code></pre>
      </section>
      <ImportForm newPostId={randomUUID()} action={importMarkdownAction} />
    </main>
  )
}
