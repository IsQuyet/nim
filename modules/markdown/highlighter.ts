import { createBundledHighlighter, makeSingletonHighlighter } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export const MARKDOWN_CODE_THEME = 'tokyo-night'

const languages = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
}

const aliases = {
  js: 'javascript', ts: 'typescript', rs: 'rust', sh: 'shellscript', bash: 'shellscript',
  shell: 'shellscript', py: 'python', yml: 'yaml', md: 'markdown', docker: 'dockerfile',
} satisfies Record<string, keyof typeof languages>

const createHighlighter = createBundledHighlighter<string, string>({
  langs: languages,
  themes: {
    [MARKDOWN_CODE_THEME]: () => import('shiki/themes/tokyo-night.mjs'),
  },
  engine: () => createJavaScriptRegexEngine(),
})

const getHighlighter = makeSingletonHighlighter(createHighlighter)

export function getMarkdownHighlighter() {
  return getHighlighter({ themes: [MARKDOWN_CODE_THEME], langs: [], langAlias: aliases })
}
