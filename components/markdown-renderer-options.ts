import { defaultUrlTransform, type Options } from 'react-markdown'
import { markdownRemarkPlugins, markdownRehypeOptions } from '@/lib/markdown-syntax'
import rehypePrettyCode, { type Options as PrettyCodeOptions } from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings, { type Options as HeadingLinkOptions } from 'rehype-autolink-headings'
import { getMarkdownHighlighter, MARKDOWN_CODE_THEME } from '@/lib/markdown-highlighter'

const prettyCodeOptions = {
  defaultLang: { block: 'plaintext' },
  theme: MARKDOWN_CODE_THEME,
  keepBackground: false,
  bypassInlineCode: true,
  filterMetaString: () => '',
  grid: false,
  getHighlighter: getMarkdownHighlighter,
} satisfies PrettyCodeOptions

const headingLinkOptions = {
  behavior: 'append',
  test: heading => heading.position !== undefined,
  content: { type: 'text', value: '#' },
  properties: {
    className: ['markdown-heading-anchor', 'not-prose'],
    ariaLabel: 'Link to this section',
  },
} satisfies HeadingLinkOptions

export const markdownRenderOptions = {
  remarkPlugins: markdownRemarkPlugins,
  remarkRehypeOptions: markdownRehypeOptions,
  rehypePlugins: [
    [rehypePrettyCode, prettyCodeOptions],
    rehypeSlug,
    [rehypeAutolinkHeadings, headingLinkOptions],
  ],
  skipHtml: true,
  urlTransform: defaultUrlTransform,
} satisfies Pick<Options, 'remarkPlugins' | 'remarkRehypeOptions' | 'rehypePlugins' | 'skipHtml' | 'urlTransform'>
