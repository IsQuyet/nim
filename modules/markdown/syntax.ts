import remarkGfm from 'remark-gfm'
import type { Options as RemarkRehypeOptions } from 'remark-rehype'
import type { PluggableList } from 'unified'

export const markdownRemarkPlugins = [remarkGfm] satisfies PluggableList
export const markdownRehypeOptions = { allowDangerousHtml: true } satisfies RemarkRehypeOptions
