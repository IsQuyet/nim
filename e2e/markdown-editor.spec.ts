import { type Page } from '@playwright/test'
import { recoveryCopySchema } from '../modules/posts/writing'
import { createTestDraft } from '../test/post-commands'
import { test, expect, snapshot, withWritingStore } from './fixtures'

async function localBody(page: Page) {
  const records = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readonly')
        const request = transaction.objectStore('copies').getAll()
        let result: unknown[] = []
        request.onsuccess = () => { result = request.result }
        transaction.oncomplete = () => resolve(result)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { database.close() }
  })
  return recoveryCopySchema.array().parse(records).at(-1)?.content.body ?? null
}

async function textPoint(page: Page, needle: string, offset: number) {
  return page.getByRole('textbox', { name: 'Body', exact: true }).evaluate((content, target) => {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const start = node.textContent?.indexOf(target.needle) ?? -1
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(node, start + target.offset)
      range.setEnd(node, start + target.offset + 1)
      const bounds = range.getBoundingClientRect()
      return { x: bounds.x + bounds.width * 0.1, y: bounds.y + bounds.height * 0.5 }
    }
    throw new Error(`Visible text was not found: ${target.needle}`)
  }, { needle, offset })
}

async function caretState(page: Page) {
  return page.getByRole('textbox', { name: 'Body', exact: true }).evaluate(content => {
    const selection = window.getSelection()
    return {
      focused: content === document.activeElement,
      collapsed: selection?.isCollapsed ?? false,
      inside: Boolean(selection && content.contains(selection.anchorNode)),
      visible: content.textContent ?? '',
    }
  })
}

const clickCases = [
  { name: '加粗', source: 'Before **Bold sample** after\n\nOutside', needle: 'Bold sample', offset: 3 },
  { name: '斜体', source: 'Before *Italic sample* after\n\nOutside', needle: 'Italic sample', offset: 3 },
  { name: '删除线', source: 'Before ~~Removed sample~~ after\n\nOutside', needle: 'Removed sample', offset: 3 },
  { name: '行内代码', source: 'Before `code sample` after\n\nOutside', needle: 'code sample', offset: 3 },
  { name: '链接', source: 'Before [Link sample](https://example.test) after\n\nOutside', needle: 'Link sample', offset: 3 },
  ...[1, 2, 3, 4, 5, 6].map(level => ({ name: `${level} 级标题`, source: `${'#'.repeat(level)} Heading sample\n\nOutside`, needle: 'Heading sample', offset: 3 })),
  { name: '标题后的加粗', source: '## Heading\n\nBefore **Bold sample** after\n\nOutside', needle: 'Bold sample', offset: 3 },
  { name: '多个标题后的正文', source: '# First\n\n## Second\n\nPlain sample\n\nOutside', needle: 'Plain sample', offset: 3 },
  { name: '窄屏换行后的加粗', source: '## Heading\n\nA paragraph that wraps on a narrow screen before **Bold sample** and continues after it.\n\nOutside', needle: 'Bold sample', offset: 3 },
  { name: '引用', source: '> Quoted sample\n\nOutside', needle: 'Quoted sample', offset: 3 },
  { name: '列表', source: '- Listed sample\n\nOutside', needle: 'Listed sample', offset: 3 },
]

const markerCases = [
  { name: '列表标记', source: '- Listed sample\n\nOutside', selector: '.cm-md-list-marker', line: '- Listed sample' },
  { name: '有序列表标记', source: '1. Listed sample\n\nOutside', selector: '.cm-md-list-marker', line: '1. Listed sample' },
  { name: '未完成任务', source: '- [ ] Task sample\n\nOutside', selector: '.cm-md-task-marker', line: '- [ ] Task sample' },
  { name: '已完成任务', source: '- [x] Task sample\n\nOutside', selector: '.cm-md-task-marker', line: '- [x] Task sample' },
]

for (const input of [
  { name: '鼠标', touch: false, viewport: { width: 1280, height: 900 } },
  { name: '触摸', touch: true, viewport: { width: 390, height: 844 } },
]) {
  test.describe(`${input.name}编辑 Markdown`, () => {
    test.use({ viewport: input.viewport, hasTouch: input.touch, isMobile: input.touch })

    async function pointAtText(page: Page, needle: string, offset: number) {
      const point = await textPoint(page, needle, offset)
      if (input.touch) await page.touchscreen.tap(point.x, point.y)
      else await page.mouse.click(point.x, point.y)
    }

    for (const scenario of clickCases) {
      test(`直接点击${scenario.name}后在对应位置输入`, async ({ page, login, runtime }) => {
        await login()
        const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Markdown navigation', description: '', body: scenario.source }))
        await page.goto(`/admin/posts/${draft.id}`)
        await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
        const baseline = snapshot(runtime, draft.id)
        const body = page.getByRole('textbox', { name: 'Body', exact: true })
        await body.press('ControlOrMeta+End')
        await page.getByLabel('Title', { exact: true }).focus()
        await pointAtText(page, scenario.needle, scenario.offset)
        await expect.poll(() => caretState(page)).toMatchObject({ focused: true, collapsed: true, inside: true })
        await page.keyboard.insertText('Ω')
        const position = scenario.source.indexOf(scenario.needle) + scenario.offset
        const expected = `${scenario.source.slice(0, position)}Ω${scenario.source.slice(position)}`
        await expect.poll(() => localBody(page)).toBe(expected)
        expect(snapshot(runtime, draft.id)).toEqual(baseline)
      })
    }

    for (const scenario of markerCases) {
      test(`点击${scenario.name}进入对应行且不改写原文`, async ({ page, login, runtime }) => {
        await login()
        const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Marker navigation', description: '', body: scenario.source }))
        await page.goto(`/admin/posts/${draft.id}`)
        await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
        const baseline = snapshot(runtime, draft.id)
        const body = page.getByRole('textbox', { name: 'Body', exact: true })
        await body.press('ControlOrMeta+End')
        await page.getByLabel('Title', { exact: true }).focus()
        const marker = page.locator(scenario.selector).first()
        if (input.touch) await marker.tap()
        else await marker.click()
        await expect.poll(() => caretState(page)).toMatchObject({ focused: true, collapsed: true, inside: true })
        await expect(body).toContainText(scenario.line)
        await page.getByRole('button', { name: 'Save draft', exact: true }).click()
        await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
        const saved = snapshot(runtime, draft.id)
        expect(saved.revisions).toEqual(baseline.revisions)
        expect(saved.drafts).toEqual(baseline.drafts)
        expect(saved.revisions.at(-1)?.body).toBe(scenario.source)
      })
    }

    test('进入格式化片段才揭示语法，键盘移动后仍在正确位置输入', async ({ page, login, runtime }) => {
      await login()
      const source = 'Before **Bold sample** after [Link sample](https://example.test)\n\nOutside'
      const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Inline navigation', description: '', body: source }))
      await page.goto(`/admin/posts/${draft.id}`)
      await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
      const body = page.getByRole('textbox', { name: 'Body', exact: true })
      await body.press('ControlOrMeta+End')
      await expect(body).not.toContainText('**Bold sample**')
      await pointAtText(page, 'Bold sample', 3)
      await expect(body).toContainText('**Bold sample**')
      await expect(body).not.toContainText('https://example.test')
      await body.press('ArrowRight')
      await page.keyboard.insertText('Ω')
      const position = source.indexOf('Bold sample') + 4
      await expect.poll(() => localBody(page)).toBe(`${source.slice(0, position)}Ω${source.slice(position)}`)
      await body.press('ControlOrMeta+End')
      await expect(body).not.toContainText('**Bold')
    })
  })
}
