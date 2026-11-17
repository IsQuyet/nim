import { parseDocument, stringify } from 'yaml'
import { z } from 'zod'
import { postContentSchema, postIdSchema, type ImportDraftInput, type ImportPostInput } from '../model'

export const POST_FILE_FORMAT = 'nim-post/v1'

export const postFileMetadataSchema = z.strictObject({
  ...postContentSchema.omit({ body: true }).shape,
  description: postContentSchema.shape.description.default(''),
  format: z.literal(POST_FILE_FORMAT).default(POST_FILE_FORMAT),
  id: postIdSchema.optional(),
})

type MarkdownFileResult =
  | { success: true; data: ImportDraftInput }
  | { success: false; message: string }

export function parseMarkdownFile(source: string): MarkdownFileResult {
  const documentSource = source.charCodeAt(0) === 0xFEFF ? source.slice(1) : source
  const opening = /^---[ \t]*\r?\n/.exec(documentSource)
  if (!opening) return { success: false, message: 'Start the file with YAML front matter containing a title.' }

  const remaining = documentSource.slice(opening[0].length)
  const closing = /(?<=^|\n)---[ \t]*(?:\r?\n|$)/.exec(remaining)
  if (!closing) return { success: false, message: 'The YAML front matter is missing its closing delimiter.' }

  let metadata: unknown
  try {
    const document = parseDocument(remaining.slice(0, closing.index), { schema: 'core', uniqueKeys: true })
    if (document.errors.length || document.warnings.length) {
      return { success: false, message: 'The YAML front matter is invalid.' }
    }
    metadata = document.toJS({ maxAliasCount: 100 })
  } catch {
    return { success: false, message: 'The YAML front matter is invalid.' }
  }

  const parsed = postFileMetadataSchema.safeParse(metadata)
  if (!parsed.success) {
    return { success: false, message: parsed.error.issues.map(issue => issue.message).join(' ') }
  }
  const { id, title, description } = parsed.data
  return {
    success: true,
    data: {
      ...(id === undefined ? {} : { id }),
      title,
      description,
      body: remaining.slice(closing.index + closing[0].length),
    },
  }
}

export function serializeMarkdownFile(input: ImportPostInput): string {
  const content = postContentSchema.parse(input)
  const metadata = postFileMetadataSchema.required({ id: true }).parse({
    id: input.id,
    title: content.title,
    description: content.description,
  })
  const frontMatter = stringify({
    format: metadata.format,
    id: metadata.id,
    title: metadata.title,
    description: metadata.description,
  }, { lineWidth: 0, defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN' })
  return `---\n${frontMatter}---\n${content.body}`
}
