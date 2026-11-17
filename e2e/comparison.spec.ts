import { expect, test, snapshot, withWritingStore } from './fixtures'
import { createTestDraft, publishTestDraft } from '../test/post-commands'
import { postIdSchema } from '../modules/posts/model'

const emptyServer = { posts: [], revisions: [], drafts: [], publications: [], published: [], receipts: [] }

test('编辑器将未保存内容与当前发布快照并列预览，不写入服务器', async ({ page, login, runtime }) => {
  await login()
  const published = await withWritingStore(runtime, writer => {
    const draft = createTestDraft(writer, {
      title: 'Published title',
      description: 'Published summary',
      body: '# Published body\n\n| Name | Value |\n| --- | --- |\n| Old | 1 |',
    })
    return publishTestDraft(writer, draft)
  })
  await page.goto(`/admin/posts/${published.id}`)
  await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
  const baseline = snapshot(runtime, published.id)

  await page.getByLabel('Title', { exact: true }).fill('Current title')
  await page.getByLabel('Description', { exact: true }).fill('Current summary')
  await page.getByLabel('Body', { exact: true }).fill('# Current body\n\n| Name | Value |\n| --- | --- |\n| New | 2 |')
  await expect(page.getByText('Unsaved changes. Not saved to the server.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Compare with published', exact: true }).click()

  const comparison = page.getByRole('region', { name: 'Rendered version comparison' })
  const before = comparison.getByRole('article', { name: 'Published version' })
  const after = comparison.getByRole('article', { name: 'Current editor text' })
  await expect(before).toContainText('Published title')
  await expect(before).toContainText('Published summary')
  await expect(before).toContainText('Old')
  await expect(before.getByRole('table')).toBeVisible()
  await expect(after).toContainText('Current title')
  await expect(after).toContainText('Current summary')
  await expect(after).toContainText('New')
  await expect(after.getByRole('table')).toBeVisible()
  expect(snapshot(runtime, published.id)).toEqual(baseline)
  await expect(page.getByText('Unsaved changes. Not saved to the server.', { exact: true })).toBeVisible()
})

test('未发布新稿对照时明确显示没有发布基线', async ({ page, login, runtime }) => {
  await login()
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  const id = postIdSchema.parse(new URL(page.url()).searchParams.get('draft'))
  await page.getByLabel('Title', { exact: true }).fill('Local only title')
  await page.getByLabel('Body', { exact: true }).fill('Local only body')
  await page.getByRole('button', { name: 'Compare with published', exact: true }).click()

  const comparison = page.getByRole('region', { name: 'Rendered version comparison' })
  await expect(comparison.getByText('This post has not been published yet.', { exact: true })).toBeVisible()
  await expect(comparison.getByRole('article', { name: 'Published version' })).toHaveCount(0)
  await expect(comparison.getByRole('article', { name: 'Current editor text' })).toContainText('Local only body')
  expect(snapshot(runtime, id)).toEqual(emptyServer)
})
