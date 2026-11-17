// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { getMarkdownHighlighter, MARKDOWN_CODE_THEME } from './highlighter'

describe('Markdown 高亮资源', () => {
  it('复用同一实例，主题与语言只能由注册表提供', async () => {
    const highlighter = await getMarkdownHighlighter()
    expect(await getMarkdownHighlighter()).toBe(highlighter)
    expect(highlighter.getLoadedThemes()).toContain(MARKDOWN_CODE_THEME)
    await highlighter.loadLanguage('rs')
    expect(highlighter.getLoadedLanguages()).toContain('rust')
    const before = highlighter.getLoadedLanguages()
    await expect(Promise.resolve().then(() => highlighter.loadLanguage('not-registered')))
      .rejects.toThrow('not included in this bundle')
    expect(highlighter.getLoadedLanguages()).toEqual(before)
    expect(highlighter.getBundledLanguages()).not.toHaveProperty('haskell')
  })
})
