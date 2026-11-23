import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAdminSession } from '@/modules/auth/server/auth'
import { importMarkdownAction } from '@/modules/posts/server/actions/import'
import { ImportForm } from '@/modules/posts/ui/import-form'
import { routes } from '@/lib/routes'

export const metadata: Metadata = { title: 'Import Markdown' }

const example = '---\ntitle: Imported draft\n---\n\n# Markdown body\n'

export default async function ImportPage() {
  await requireAdminSession()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <Link href={routes.admin.home} className="text-sm text-muted-foreground underline underline-offset-4">
          Back to posts
        </Link>
        <h1 className="text-lg font-medium">Import Markdown</h1>
        <p className="text-muted-foreground">
          YAML front matter must include title. Description is optional and defaults to an empty string. The id field is optional.
        </p>
        <p className="text-muted-foreground">
          Only the id field selects an existing article, never the filename. Importing completely replaces its draft without publishing.
        </p>
        <p className="text-muted-foreground">
          Without an id, this import attempt creates a new draft. Retrying the same file reuses it. The UTF-8 Markdown body is preserved exactly.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm"><code>{example}</code></pre>
      </section>
      <ImportForm newPostId={randomUUID()} action={importMarkdownAction} />
    </main>
  )
}
