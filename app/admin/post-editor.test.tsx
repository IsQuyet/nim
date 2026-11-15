import { redirect } from 'next/navigation'
import { Component, StrictMode, Suspense, type ReactNode } from 'react'
import { act, fireEvent, render as renderComponent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { samePostContent, type DraftPost } from '@/lib/content'
import { recoveryCopySchema, type RecoveryCopy, type WritingAcknowledgement, type WritingCommand, type WritingTransport } from '@/lib/writing'
import { PostEditor } from './post-editor'
import { WritingSessionsProvider } from './writing-sessions'
import { useWritingSession } from './use-writing-session'

function render(ui: ReactNode) { return renderComponent(ui, { wrapper: WritingSessionsProvider }) }
const routing = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', async importOriginal => ({ ...await importOriginal<typeof import('next/navigation')>(), useRouter: () => routing }))
const local = vi.hoisted(() => ({ copies: new Map<string, RecoveryCopy>(), failure: false }))
vi.mock('@/lib/recovery-store', () => ({
  createRecoveryStore: () => ({
    async list(postId?: string) { return [...local.copies.values()].filter(copy => postId === undefined || copy.postId === postId).map(copy => recoveryCopySchema.parse(copy)) },
    async put(copy: RecoveryCopy) {
      if (local.failure) throw new Error('Local quota exceeded')
      local.copies.set(copy.sessionId, recoveryCopySchema.parse(copy))
    },
    async remove(sessionId: string) { local.copies.delete(sessionId) },
    close() {},
  }),
}))
vi.mock('./writing-actions', () => ({ readDraftAction: vi.fn(), writeDraftAction: vi.fn(), inspectDraftOperationAction: vi.fn() }))

class EditorBoundary extends Component<{ children: ReactNode; onError?: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { this.props.onError?.(error) }
  render() { return this.state.failed ? <p>Editor unavailable</p> : this.props.children }
}

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const time = '2026-11-15T12:00:00.000Z'
const content = { title: 'A draft', description: 'Description.', body: '# First body' }
const initial: DraftPost = { id, ...content, revisionId: 1, createdAt: time, updatedAt: time }
let server: DraftPost | null
let revision: number
let connection: WritingTransport
let read: ReturnType<typeof vi.fn<WritingTransport['read']>>
let write: ReturnType<typeof vi.fn<WritingTransport['write']>>
let inspect: ReturnType<typeof vi.fn<WritingTransport['inspect']>>
const receipts = new Map<string, WritingAcknowledgement>()
function body() { return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' }) }
async function ready() { await screen.findByText('No unsaved changes.') }
function form() { return screen.getByRole('form', { name: 'Draft' }) }
function commit(command: WritingCommand): Awaited<ReturnType<WritingTransport['write']>> {
  const receipt = receipts.get(command.operationId)
  if (receipt) return { status: 'success', value: receipt }
  const previous = server?.id === command.postId ? server : null
  if ((previous?.revisionId ?? null) !== command.expectedRevisionId) return { status: 'conflict', current: previous }
  server = previous && samePostContent(previous, command.content) ? previous : {
    id: command.postId, ...command.content, revisionId: ++revision, createdAt: previous?.createdAt ?? time, updatedAt: time,
  }
  const value = { draft: server, publication: command.intent === 'publish' ? { id: revision, publishedAt: time } : null }
  receipts.set(command.operationId, value)
  return { status: 'success', value }
}
function copy(bodyText: string, pending: WritingCommand | null = null): RecoveryCopy {
  return { format: 'nim-recovery/v2', sessionId: crypto.randomUUID(), postId: id, content: { ...content, body: bodyText }, remote: initial, pending, updatedAt: time }
}

beforeEach(() => {
  routing.replace.mockReset().mockImplementation((url: string) => window.history.replaceState(null, '', url))
  local.copies.clear()
  local.failure = false
  receipts.clear()
  server = { ...initial }
  revision = 1
  read = vi.fn<WritingTransport['read']>().mockImplementation(async postId => ({ status: 'success', value: server?.id === postId ? server : null }))
  write = vi.fn<WritingTransport['write']>().mockImplementation(async command => commit(command))
  inspect = vi.fn<WritingTransport['inspect']>().mockImplementation(async operation => {
    const value = receipts.get(operation.operationId)
    return value ? { status: 'success', value } : { status: 'unconfirmed' }
  })
  connection = { read, write, inspect }
  window.history.replaceState(null, '', `/admin/posts/${id}`)
})
afterEach(() => { vi.useRealTimers() })

describe('明确保存与本机恢复编辑器', () => {
  it('首次远端检查完成前显示检查状态，不提前表示草稿已确认', async () => {
    const checking = Promise.withResolvers<Awaited<ReturnType<WritingTransport['read']>>>()
    read.mockReturnValueOnce(checking.promise)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    expect(screen.queryByText('No unsaved changes.')).toBeNull()
    await screen.findByText('Checking server draft…')
    await act(async () => checking.resolve({ status: 'success', value: initial }))
    await ready()
  })

  it('编辑与停顿只保留本机副本，显示尚未提交，不写服务器', async () => {
    vi.useFakeTimers()
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.change(body(), { target: { value: 'Unsubmitted text' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(body().value).toBe('Unsubmitted text')
    expect(screen.getByText('Unsaved changes. Not saved to the server.')).toBeDefined()
    expect(screen.getByText('Recovery copy saved on this browser.')).toBeDefined()
    expect(write).not.toHaveBeenCalled()
    expect(server).toEqual(initial)
  })

  it('手动保存期间继续输入，旧确认不替换新文字或误报新文字已保存', async () => {
    const pending = Promise.withResolvers<Awaited<ReturnType<WritingTransport['write']>>>()
    write.mockReturnValueOnce(pending.promise)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Submitted text' } })
    fireEvent.submit(form())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(body().disabled).toBe(false)
    fireEvent.change(body(), { target: { value: 'Kept while saving' } })
    await act(async () => pending.resolve(commit(write.mock.calls[0][0])))
    expect(body().value).toBe('Kept while saving')
    expect(screen.queryByText('Draft saved.')).toBeNull()
    expect(server?.body).toBe('Submitted text')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('明确发布只提交点击时的可见内容和修订基线', async () => {
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Visible at publish' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByText('Post published.')
    expect(write.mock.calls[0][0]).toMatchObject({ intent: 'publish', expectedRevisionId: 1, content: { ...content, body: 'Visible at publish' } })
  })

  it('未收到的保存需要明确重试，检查与重新联网都不代执行', async () => {
    write.mockRejectedValueOnce(new Error('offline'))
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Originally submitted' } })
    fireEvent.submit(form())
    await screen.findByRole('region', { name: 'Unconfirmed operation' })
    fireEvent.change(body(), { target: { value: 'Newer unsubmitted edits' } })
    await act(async () => window.dispatchEvent(new Event('online')))
    fireEvent.click(screen.getByRole('button', { name: 'Check previous operation' }))
    await waitFor(() => expect(inspect).toHaveBeenCalled())
    expect(write).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/Retrying submits the same snapshot/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry previous save' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2))
    expect(write.mock.calls[1][0]).toEqual(write.mock.calls[0][0])
    await screen.findByText('Unsaved changes. Not saved to the server.')
    expect(body().value).toBe('Newer unsubmitted edits')
    expect(server?.body).toBe('Originally submitted')
    fireEvent.submit(form())
    await screen.findByText('Draft saved.')
    expect(server?.body).toBe('Newer unsubmitted edits')
  })

  it('已提交却丢响应的操作可只读确认，不重发保存', async () => {
    write.mockImplementationOnce(async command => { commit(command); throw new Error('Response lost') })
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Already committed' } })
    fireEvent.submit(form())
    await screen.findByRole('region', { name: 'Unconfirmed operation' })
    fireEvent.click(screen.getByRole('button', { name: 'Check previous operation' }))
    await screen.findByText('Previous save confirmed.')
    expect(write).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Unconfirmed operation' })).toBeNull()
  })

  it('真实 Next 控制流由 React 边界处理，不吞成普通失败', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let signal: unknown
    try { redirect('/admin/login') } catch (error) { signal = error }
    write.mockRejectedValueOnce(signal)
    const caught = vi.fn()
    render(<EditorBoundary onError={caught}><PostEditor postId={id} initial={initial} transport={connection} /></EditorBoundary>)
    await ready()
    fireEvent.submit(form())
    await screen.findByText('Editor unavailable')
    expect(caught).toHaveBeenCalledExactlyOnceWith(signal)
  })

  it('普通 props 更新不覆盖文字或改变当前编辑基线', async () => {
    const view = render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Local text' } })
    view.rerender(<PostEditor postId={id} initial={{ ...initial, revisionId: 99, body: 'Remote props' }} transport={connection} />)
    fireEvent.submit(form())
    await screen.findByText('Draft saved.')
    expect(write.mock.calls[0][0]).toMatchObject({ postId: id, expectedRevisionId: 1, content: { body: 'Local text' } })
  })

  it('页面节点替换沿用活跃会话，保留请求期间输入', async () => {
    server = null
    const pending = Promise.withResolvers<Awaited<ReturnType<WritingTransport['write']>>>()
    write.mockReturnValueOnce(pending.promise)
    const view = render(<section key="new"><PostEditor postId={id} initial={null} transport={connection} /></section>)
    await screen.findByText('Ready to write.')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: content.title } })
    fireEvent.change(body(), { target: { value: 'Submitted from new page' } })
    fireEvent.submit(form())
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    fireEvent.change(body(), { target: { value: 'New local text' } })
    await act(async () => pending.resolve(commit(write.mock.calls[0][0])))
    view.rerender(<section key="edit"><PostEditor postId={id} initial={server} transport={connection} /></section>)
    expect(body().value).toBe('New local text')
    fireEvent.submit(form())
    await screen.findByText('Draft saved.')
    expect(write.mock.calls[1][0].expectedRevisionId).toBe(2)
  })

  it('被 Suspense 放弃的渲染不污染已提交会话', async () => {
    const waiting = new Promise<void>(() => {})
    function WaitingEditor(): ReactNode {
      useWritingSession({ postId: id, initial, transport: connection })
      throw waiting
    }
    const view = render(<Suspense fallback={<p>Waiting</p>}><WaitingEditor /></Suspense>)
    expect(screen.getByText('Waiting')).toBeDefined()
    server = { ...initial, revisionId: 2, body: 'Latest committed text' }
    view.rerender(<PostEditor postId={id} initial={server} transport={connection} />)
    await ready()
    expect(body().value).toBe('Latest committed text')
  })

  it('Strict Mode 重订阅不结束会话或重复保存', async () => {
    render(<StrictMode><PostEditor postId={id} initial={initial} transport={connection} /></StrictMode>)
    await ready()
    fireEvent.change(body(), { target: { value: 'Strict mode writing' } })
    fireEvent.submit(form())
    await screen.findByText('Draft saved.')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('空标题只保留本机，明确保存要求补完标题', async () => {
    server = null
    render(<PostEditor postId={id} initial={null} transport={connection} />)
    await screen.findByText('Ready to write.')
    fireEvent.change(body(), { target: { value: 'Untitled body' } })
    await screen.findByText('Recovery copy saved on this browser.')
    fireEvent.submit(form())
    expect((await screen.findByRole('alert')).textContent).toContain('Enter a title.')
    expect(write).not.toHaveBeenCalled()
  })

  it('本机失败可独立重试恢复副本，不触发服务器保存', async () => {
    local.failure = true
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Local failed text' } })
    await screen.findByText('Local recovery is unavailable. Keep this page open or explicitly save to the server.')
    local.failure = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry local recovery' }))
    await screen.findByText('Recovery copy saved on this browser.')
    expect(write).not.toHaveBeenCalled()
  })

  it('本机失败不阻止用户明确保存到服务器', async () => {
    local.failure = true
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'Explicit server protection' } })
    fireEvent.submit(form())
    await screen.findByText('Draft saved.')
    expect(screen.queryByText('Recovery copy saved on this browser.')).toBeNull()
    expect(server?.body).toBe('Explicit server protection')
  })

  it('恢复本机文本保留源分支，不上传恢复结果', async () => {
    const source = copy('Recovered local text')
    local.copies.set(source.sessionId, source)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    const recovery = await screen.findByRole('region', { name: 'Local recovery copies' })
    fireEvent.click(within(recovery).getByRole('button', { name: 'Recover this copy' }))
    await waitFor(() => expect(body().value).toBe('Recovered local text'))
    expect(local.copies.get(source.sessionId)).toEqual(source)
    expect(write).not.toHaveBeenCalled()
    expect(server).toEqual(initial)
  })

  it('远端挂起时仍能选择本机恢复副本', async () => {
    const source = copy('Offline recovery text')
    local.copies.set(source.sessionId, source)
    const checking = Promise.withResolvers<Awaited<ReturnType<WritingTransport['read']>>>()
    read.mockReturnValueOnce(checking.promise)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await screen.findByRole('region', { name: 'Local recovery copies' })
    expect(write).not.toHaveBeenCalled()
    await act(async () => checking.resolve({ status: 'success', value: initial }))
  })

  it('恢复含未确认发布的副本只查回执，不重新发布', async () => {
    const pending: WritingCommand = { postId: id, operationId: crypto.randomUUID(), expectedRevisionId: 1, intent: 'publish', content: { ...content, body: 'Previous publish snapshot' } }
    const source = copy('Newer local text', pending)
    local.copies.set(source.sessionId, source)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    const recovery = await screen.findByRole('region', { name: 'Local recovery copies' })
    fireEvent.click(within(recovery).getByRole('button', { name: 'Recover this copy' }))
    await screen.findByRole('button', { name: 'Retry previous publish' })
    expect(inspect).toHaveBeenCalledWith({ postId: id, operationId: pending.operationId })
    expect(body().value).toBe('Newer local text')
    expect(write).not.toHaveBeenCalled()
  })

  it('冲突选择另存新稿只改变本机身份，不创建服务器文章', async () => {
    const changed = { ...initial, revisionId: 2, body: 'Remote text' }
    write.mockResolvedValueOnce({ status: 'conflict', current: changed })
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    await ready()
    fireEvent.change(body(), { target: { value: 'My local branch' } })
    fireEvent.submit(form())
    const conflict = await screen.findByRole('region', { name: 'Draft conflict' })
    fireEvent.click(within(conflict).getByRole('button', { name: 'Keep local text as a new draft' }))
    await waitFor(() => expect(new URL(location.href).searchParams.get('draft')).not.toBe(id))
    expect(body().value).toBe('My local branch')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('删除本机副本需要确认，取消不删除', async () => {
    const source = copy('Old local text')
    local.copies.set(source.sessionId, source)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<PostEditor postId={id} initial={initial} transport={connection} />)
    const recovery = await screen.findByRole('region', { name: 'Local recovery copies' })
    fireEvent.click(within(recovery).getByRole('button', { name: 'Delete local copy' }))
    expect(local.copies.has(source.sessionId)).toBe(true)
    confirm.mockReturnValue(true)
    fireEvent.click(within(recovery).getByRole('button', { name: 'Delete local copy' }))
    await waitFor(() => expect(local.copies.has(source.sessionId)).toBe(false))
    expect(write).not.toHaveBeenCalled()
  })

  it('未提交内容的离开提醒可取消，下载与新标签不拦截', async () => {
    render(<div onClick={event => event.preventDefault()}><a href="/admin">Back to posts</a><a href="/admin/login" target="_blank" rel="noopener noreferrer">New tab login</a><PostEditor postId={id} initial={initial} transport={connection} /></div>)
    await ready()
    fireEvent.change(body(), { target: { value: 'Unsaved text' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('link', { name: 'Download saved draft' }))
    fireEvent.click(screen.getByRole('link', { name: 'New tab login' }))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'Back to posts' }))
    expect(confirm).toHaveBeenCalledTimes(1)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('预览保持同一份原文和 GFM 规则，不保存到服务器', async () => {
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
    expect(write).not.toHaveBeenCalled()
  }, 15_000)
})
