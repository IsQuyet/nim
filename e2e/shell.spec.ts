import { createTestDraft, publishTestDraft } from '../test/post-commands'
import { test, expect, withWritingStore } from './fixtures'

const phone = { width: 390, height: 800 }
const desktop = { width: 1280, height: 800 }

test('宽屏的栏目在页头，窄屏的栏目收进侧边导航，同一栏目只出现在一处', async ({ page }) => {
  await page.setViewportSize(desktop)
  await page.goto('/')
  const pinned = page.getByRole('navigation', { name: 'Main' })
  await expect(pinned.getByRole('link', { name: 'Blog', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden()

  await page.setViewportSize(phone)
  await expect(pinned).toBeHidden()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const drawer = page.getByRole('dialog')
  await drawer.getByRole('link', { name: 'Blog', exact: true }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(drawer).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Blog', level: 1 })).toBeVisible()
})

test('页头、主体和页脚的内容沿同一画布对齐，各宽度下页面不出现横向滚动', async ({ page }) => {
  for (const width of [360, 390, 700, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/blog')
    const header = await page.locator('header .canvas').boundingBox()
    const footer = await page.locator('footer .canvas').boundingBox()
    expect(header && footer && header.x === footer.x && header.width === footer.width, `宽度 ${width}`).toBe(true)
    expect(header!.width, `宽度 ${width}`).toBeLessThanOrEqual(1200 + 48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `宽度 ${width}`).toBe(true)
  }
})

test('主题菜单切换明暗并在刷新后保持', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Theme' }).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Theme' }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeChecked()
})

test('访客从页头进入登录页，管理员从页头菜单进入管理、新建草稿并退出', async ({ page, login }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Admin menu' })).toBeHidden()
  await page.getByRole('link', { name: 'Admin', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/login$/)

  await login()
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin menu' }).click()
  await page.getByRole('menuitem', { name: 'New draft' }).click()
  await expect(page).toHaveURL(/\/admin\/posts\/new\?draft=/)

  await page.goto('/')
  await page.getByRole('button', { name: 'Admin menu' }).click()
  await page.getByRole('menuitem', { name: 'Content' }).click()
  await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Admin menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible()
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login$/)
})

test('文章页在宽屏显示停靠目录并随跳转高亮，在窄屏折叠在正文上方', async ({ page, runtime }) => {
  const fillers = Array.from({ length: 18 }, (_, index) => `Paragraph ${index + 1} with enough content to create scroll distance.`).join('\n\n')
  const post = await withWritingStore(runtime, writer => {
    const draft = createTestDraft(writer, {
      title: 'Reading layout with ToC',
      description: 'Test headings',
      body: `# Reading layout\n\n## First section\n\n${fillers}\n\n### Nested detail\n\n${fillers}\n\n## Closing notes\n\nEnd.`,
    })
    return publishTestDraft(writer, draft)
  })

  await page.setViewportSize(desktop)
  await page.goto(`/blog/${post.id}`)
  const desktopToc = page.getByRole('navigation', { name: 'On this page' })
  await expect(desktopToc).toBeVisible()
  const closingLink = desktopToc.getByRole('link', { name: 'Closing notes', exact: true })
  await closingLink.click()
  await expect(page).toHaveURL(new RegExp(`/blog/${post.id}#closing-notes$`))
  await expect(closingLink).toHaveAttribute('aria-current', 'location')

  await page.setViewportSize(phone)
  await expect(desktopToc).toBeHidden()
  const summary = page.locator('details > summary', { hasText: 'On this page' })
  await expect(summary).toBeVisible()
  await summary.click()
  const mobileToc = page.getByRole('navigation', { name: 'On this page' })
  await expect(mobileToc).toBeVisible()
  await mobileToc.getByRole('link', { name: 'First section', exact: true }).click()
  await expect(mobileToc).toBeHidden()
})
