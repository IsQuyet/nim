import { randomUUID } from 'node:crypto'
import type { Metadata } from 'next'
import { Focus } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { requireAdminSession } from '@/modules/auth/server/auth'
import { importMarkdownAction } from '@/modules/posts/server/actions/import'
import { ImportForm } from '@/modules/posts/ui/import-form'
import { routes } from '@/lib/routes'

export const metadata: Metadata = { title: 'Import Markdown' }

const example = '---\ntitle: Imported draft\n---\n\n# Markdown body\n'

export default async function ImportPage() {
  await requireAdminSession()

  return (
    <Focus>
      <main>
        <PageHeader title="Import Markdown" back={{ href: routes.admin.home, label: 'Back to posts' }} />
        <div className="space-y-8">
          <section className="space-y-3 text-muted-foreground">
            <p>
              YAML front matter must include title. Description is optional and defaults to an empty string. The id field is optional.
            </p>
            <p>
              Only the id field selects an existing article, never the filename. Importing completely replaces its draft without publishing.
            </p>
            <p>
              Without an id, this import attempt creates a new draft. Retrying the same file reuses it. The UTF-8 Markdown body is preserved exactly.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm text-foreground"><code>{example}</code></pre>
          </section>
          <ImportForm newPostId={randomUUID()} action={importMarkdownAction} />
        </div>
      </main>
    </Focus>
  )
}
