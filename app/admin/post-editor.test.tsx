import { redirect } from 'next/navigation'
import { Component, StrictMode, Suspense, type ReactNode } from 'react'
import { act, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoveryCopySchema, type RecoveryCopy, type WorkingCopy, type WritingAcknowledgement, type WritingTransport } from '@/lib/writing'
import { PostEditor } from './post-editor'
import { WritingSessionsProvider } from './writing-sessions'
import { useWritingSession } from './use-writing-session'

function render(ui: ReactNode) { return renderComponent(ui, { wrapper: WritingSessionsProvider }) }

const routing = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => routing,
}))

const local = vi.hoisted(() => ({ copies: new Map<string, RecoveryCopy>(), failure: false }))
vi.mock('@/lib/recovery-store', () => ({
  createRecoveryStore: () => ({
    async list(postId?: string) { return [...local.copies.values()].filter(copy => postId === undefined || copy.postId === postId).map(copy => recoveryCopySchema.parse(copy)) },
    async put(copy: RecoveryCopy) {
      if (local.failure) throw new Error('Local quota exceeded')
      local.copies.set(copy.sessionId, recoveryCopySchema.parse(copy))
    },
    async remove(id: string) { local.copies.delete(id) },
    close() {},
  }),
}))
vi.mock('./writing-actions', () => ({ readWorkingCopyAction: vi.fn(), writeWorkingCopyAction: vi.fn() }))

class EditorBoundary extends Component<{ children: ReactNode; onError?: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError?.(error) }
  render() { return this.state.failed ? <p>Editor unavailable</p> : this.props.children }
}

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const time = '2026-11-15T12:00:00.000Z'
const content = { title: 'A draft', description: 'Description.', body: '# First body' }
const initial: WorkingCopy = { id, ...content, version: 'v1', checkpointRevisionId: 1, createdAt: time, updatedAt: time }
let server: WorkingCopy | null
let version: number
let connection: WritingTransport
let read: ReturnType<typeof vi.fn<WritingTransport['read']>>
let write: ReturnType<typeof vi.fn<WritingTransport['write']>>

function body() { return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' }) }
async function ready() { await screen.findByText('Synced to server.') }
function draft() { return screen.getByRole('form', { name: 'Draft' }) }
function ack(copy: WorkingCopy, publication: WritingAcknowledgement['publication'] = null) {
  return { status: 'success' as const, value: { workingCopy: copy, publication } }
}

beforeEach(() => {
  routing.replace.mockReset().mockImplementation((url: string) => window.history.replaceState(null, '', url))
  local.copies.clear()
  local.failure = false
  server = { ...initial }
  version = 1
  read = vi.fn<WritingTransport['read']>().mockImplementation(async () => ({ status: 'success', value: server }))
  write = vi.fn<WritingTransport['write']>().mockImplementation(async command => {
    server = { id: command.postId, ...command.content, version: `v${++version}`, checkpointRevisionId: command.intent === 'autosave' ? server?.checkpointRevisionId ?? null : version, createdAt: time, updatedAt: time }
    return ack(server, command.intent === 'publish' ? { id: version, publishedAt: time } : null)
  })
  connection = { read, write }
  window.history.replaceState(null, '', `/admin/posts/${id}`)
})
afterEach(() => { vi.useRealTimers() })

describe('持续写作编辑器', () => {
  it('保存请求中继续输入，旧确认不替换新文本，也不误显示完整保存成功', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<WritingTransport['write']>>>()
    write.mockReturnValueOnce(pending.promise)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Submitted text' } })
    fireEvent.submit(draft())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(body().disabled).toBe(false)
    fireEvent.change(body(), { target: { value: 'Kept while saving' } })
    const request = write.mock.calls[0][0]
    server = { ...initial, ...request.content, version: 'v2', checkpointRevisionId: 2 }
    await act(async () => pending.resolve(ack(server ?? initial)))
    expect(body().value).toBe('Kept while saving')
    expect(screen.queryByText('Draft saved.')).toBeNull()
    await waitFor(() => expect([...local.copies.values()].some(copy => copy.content.body === 'Kept while saving')).toBe(true))
  })

  it('发布捕获点击时可见内容，与自动工作稿共用版本和请求队列', async () => {
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Visible at publish' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByText('Post published.')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toMatchObject({ intent: 'publish', expectedVersion: 'v1', content: { ...content, body: 'Visible at publish' } })
  })

  it('请求拒绝保留输入和固定操作，Retry确认同一请求而不是新建操作', async () => {
    write.mockRejectedValueOnce(new Error('offline'))
    render(<EditorBoundary><PostEditor postId={id} initial={initial} transport={connection} /></EditorBoundary>)
    await ready()
    fireEvent.change(body(), { target: { value: 'Original submitted text' } })
    fireEvent.submit(draft())
    await screen.findByText('Server sync is not confirmed. Your input is preserved.')
    fireEvent.change(body(), { target: { value: 'Edited after failure' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retry sync' }))
    await waitFor(() => expect(write.mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0])
    expect(body().value).toBe('Edited after failure')
    expect(screen.queryByText('Editor unavailable')).toBeNull()
  })

  it('真实 Next 控制流交给 React 边界，不转成普通保存失败', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let signal: unknown
    try { redirect('/admin/login') } catch (error) { signal = error }
    write.mockRejectedValueOnce(signal)
    const caught = vi.fn()
    render(<EditorBoundary onError={caught}><PostEditor postId={id} initial={initial} transport={connection} /></EditorBoundary>)
    await ready()
    fireEvent.submit(draft())
    await screen.findByText('Editor unavailable')
    expect(caught).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it('普通 props 更新不改写输入、文档身份或成功基线', async () => {
    const view = render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Local text' } })
    view.rerender(<PostEditor postId="9ea8d4be-4b45-46d2-954c-3e1da354d33f" initial={{ ...initial, version: 'v99', body: 'Remote props' }} transport={connection} />)
    fireEvent.submit(draft())
    await screen.findByText('Draft saved.')
    expect(body().value).toBe('Local text')
    expect(write.mock.calls[0][0]).toMatchObject({ postId: id, expectedVersion: 'v1' })
  })

  it('新建页面被 RSC 替换为编辑页时沿用会话，保留请求期间输入和确认状态', async () => {
    server = null
    const pending = Promise.withResolvers<Awaited<ReturnType<WritingTransport['write']>>>()
    write.mockReturnValueOnce(pending.promise)
    const view = render(<section key="new-page"><PostEditor postId={id} initial={null} isNew transport={connection} /></section>)
    await screen.findByText('Ready to write.')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: content.title } })
    fireEvent.change(body(), { target: { value: 'Submitted from new page' } })
    fireEvent.submit(draft())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    fireEvent.change(body(), { target: { value: 'Typed while the page changes' } })
    server = { ...initial, ...write.mock.calls[0][0].content, version: 'v2' }
    await act(async () => pending.resolve(ack(server ?? initial)))
    const sameSession = [...local.copies.values()].find(copy => copy.content.body === 'Typed while the page changes')?.sessionId
    view.rerender(<section key="edit-page"><PostEditor postId={id} initial={server} transport={connection} /></section>)
    expect(body().value).toBe('Typed while the page changes')
    fireEvent.submit(draft())
    await screen.findByText('Draft saved.')
    expect(write.mock.calls[1][0]).toMatchObject({ postId: id, expectedVersion: 'v2', content: { body: 'Typed while the page changes' } })
    expect([...local.copies.values()].some(copy => copy.sessionId === sameSession && copy.content.body === 'Typed while the page changes')).toBe(true)
  })

  it('被 Suspense 放弃的未提交渲染不注册会话或污染后续基线', async () => {
    const waiting = new Promise<void>(() => {})
    function WaitingEditor(): ReactNode {
      useWritingSession({ postId: id, initial, isNew: false, transport: connection })
      throw waiting
    }
    const view = render(<Suspense fallback={<p>Waiting</p>}><WaitingEditor /></Suspense>)
    expect(screen.getByText('Waiting')).toBeDefined()
    server = { ...initial, version: 'v2', body: 'Latest committed initial content' }
    view.rerender(<PostEditor postId={id} initial={server} transport={connection} />)
    await ready()
    expect(body().value).toBe('Latest committed initial content')
    expect(screen.queryByRole('region', { name: 'Draft conflict' })).toBeNull()
  })

  it('Strict Mode 订阅重建不结束会话或重复发送', async () => {
    render(<StrictMode><PostEditor postId={id} initial={initial} transport={connection} /></StrictMode>)
    await ready()
    fireEvent.change(body(), { target: { value: 'Strict mode writing' } })
    fireEvent.submit(draft())
    await screen.findByText('Draft saved.')
    expect(write).toHaveBeenCalledTimes(1)
    expect(body().value).toBe('Strict mode writing')
  })

  it('空标题仍可本机保存，手动保存明确提示完成条件', async () => {
    server = null
    render(<PostEditor postId={id} initial={null} isNew transport={connection} />)
    fireEvent.change(body(), { target: { value: 'Untitled body' } })
    await screen.findByText('Recovery copy saved on this browser.')
    fireEvent.submit(draft())
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a title.')
    expect(body().value).toBe('Untitled body')
    expect(write).not.toHaveBeenCalled()
  })

  it('本机写入失败明确反馈，不显示本机已保住，仍可保存至服务器', async () => {
    local.failure = true
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Quota failure text' } })
    await screen.findByText('Local recovery is unavailable. Keep this page open or save to the server.')
    expect(screen.queryByText('Recovery copy saved on this browser.')).toBeNull()
    fireEvent.submit(draft())
    await screen.findByText('Draft saved.')
    expect(body().value).toBe('Quota failure text')
  })

  it('冲突显示两份内容，查看链接开新标签，不直接覆盖', async () => {
    const remote = { ...initial, version: 'v3', body: 'Remote conflicting text' }
    write.mockResolvedValueOnce({ status: 'conflict', current: remote })
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'My local text' } })
    fireEvent.submit(draft())
    const conflict = await screen.findByRole('region', { name: 'Draft conflict' })
    expect(body().value).toBe('My local text')
    expect(within(conflict).getByText('Remote conflicting text')).toBeDefined()
    const link = within(conflict).getByRole('link', { name: 'Review server draft in a new tab' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('href')).toBe(`/admin/posts/${id}`)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('过期会话的登录入口不替换原页，online事件重新核对并重试', async () => {
    write.mockResolvedValueOnce({ status: 'error', message: 'Sign in to sync this draft.', signInRequired: true })
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.submit(draft())
    const link = await screen.findByRole('link', { name: 'Sign in in a new tab' })
    expect(link.getAttribute('target')).toBe('_blank')
    await act(async () => window.dispatchEvent(new Event('online')))
    await screen.findByText('Draft saved.')
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0])
  })

  it('恢复列表保留原本机分支，显式恢复后续写同一文档', async () => {
    const copy: RecoveryCopy = { format: 'nim-recovery/v1', sessionId: crypto.randomUUID(), postId: id, isNew: false, content: { ...content, body: 'Recovered local text' }, remote: initial, pending: null, updatedAt: time }
    local.copies.set(copy.sessionId, copy)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    const recovery = await screen.findByRole('region', { name: 'Local recovery copies' })
    expect(write).not.toHaveBeenCalled()
    fireEvent.click(within(recovery).getByRole('button', { name: 'Recover this copy' }))
    await waitFor(() => expect(body().value).toBe('Recovered local text'))
    expect(local.copies.get(copy.sessionId)).toEqual(copy)
    expect([...local.copies.keys()].some(key => key !== copy.sessionId)).toBe(true)
  })

  it('远端检查尚未返回时，本机恢复入口仍立即可用', async () => {
    const copy: RecoveryCopy = { format: 'nim-recovery/v1', sessionId: crypto.randomUUID(), postId: id, isNew: false, content: { ...content, body: 'Offline recovery text' }, remote: initial, pending: null, updatedAt: time }
    local.copies.set(copy.sessionId, copy)
    const checking = Promise.withResolvers<Awaited<ReturnType<WritingTransport['read']>>>()
    read.mockReturnValueOnce(checking.promise)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await screen.findByRole('region', { name: 'Local recovery copies' })
    expect(write).not.toHaveBeenCalled()
    await act(async () => checking.resolve({ status: 'success', value: initial }))
  })

  it('删除恢复副本必须人类确认，取消时不删除', async () => {
    const copy: RecoveryCopy = { format: 'nim-recovery/v1', sessionId: crypto.randomUUID(), postId: id, isNew: false, content: { ...content, body: 'Old local text' }, remote: initial, pending: null, updatedAt: time }
    local.copies.set(copy.sessionId, copy)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    const recovery = await screen.findByRole('region', { name: 'Local recovery copies' })
    fireEvent.click(within(recovery).getByRole('button', { name: 'Delete local copy' }))
    expect(local.copies.has(copy.sessionId)).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(within(recovery).getByRole('button', { name: 'Delete local copy' }))
    await waitFor(() => expect(local.copies.has(copy.sessionId)).toBe(false))
    expect(screen.getByRole('button', { name: 'Continue without restoring' })).toBeDefined()
  })

  it('原生下载与另开页面不触发离开提示，当前标签导航可取消', async () => {
    render(<div onClick={event => event.preventDefault()}><a href="/admin">Back to posts</a><a href="/admin/login" target="_blank" rel="noopener noreferrer">New tab login</a><PostEditor postId={id} initial={initial} transport={connection} /></div>)
    await ready()
    fireEvent.change(body(), { target: { value: 'Unsynced' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('link', { name: 'Download server draft' }))
    fireEvent.click(screen.getByRole('link', { name: 'New tab login' }))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Back to posts' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('预览延迟挂载，切换后保留原文，使用相同 GFM 渲染', async () => {
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    const source = '# Preview heading\n\n| Name | Value |\n| --- | --- |\n| Example | 1 |'
    fireEvent.change(body(), { target: { value: source } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    const preview = screen.getByRole('region', { name: 'Markdown preview' })
    expect(await within(preview).findByText('Preview heading', { selector: 'h1' }, { timeout: 10_000 })).toBeDefined()
    expect(within(preview).getByRole('table')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(body().value).toBe(source)
  }, 15_000)
})
