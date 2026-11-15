// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingSession } from './writing-session'
import type { PostContent } from './content'
import type { RecoveryCopy, RecoveryStore, WorkingCopy, WritingCommand, WritingFeedback, WritingTransport } from './writing'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const date = '2026-11-15T00:00:00.000Z'
const text = (body = '正文', title = '标题'): PostContent => ({ title, description: '', body })
const blank = (): PostContent => ({ title: '', description: '', body: '' })
function working(id: string = crypto.randomUUID(), version = 'v1', content = text()): WorkingCopy {
  return { id, version, ...content, checkpointRevisionId: null, createdAt: date, updatedAt: date }
}
function recovery(input: Partial<RecoveryCopy> = {}): RecoveryCopy {
  return {
    format: 'nim-recovery/v1', sessionId: crypto.randomUUID(), postId: crypto.randomUUID(), isNew: true,
    content: text(), remote: null, pending: null, updatedAt: date, ...input,
  }
}
function success(command: WritingCommand, version = 'v2'): WritingFeedback {
  return {
    status: 'success', value: {
      workingCopy: { ...working(command.postId, version, command.content), checkpointRevisionId: command.intent === 'autosave' ? null : 1 },
      publication: command.intent === 'publish' ? { id: 1, publishedAt: date } : null,
    },
  }
}

class MemoryRecovery implements RecoveryStore {
  copies = new Map<string, RecoveryCopy>()
  puts: RecoveryCopy[] = []
  holds: ReturnType<typeof deferred<void>>[] = []
  hold = false
  putFailure: string | null = null
  listFailure: string | null = null
  closed = false
  list = vi.fn(async (postId?: string) => {
    if (this.listFailure) throw new Error(this.listFailure)
    return [...this.copies.values()].filter(copy => postId === undefined || copy.postId === postId).map(copy => structuredClone(copy))
  })
  put = vi.fn((copy: RecoveryCopy): Promise<void> => {
    const snapshot = structuredClone(copy)
    this.puts.push(snapshot)
    if (this.putFailure) return Promise.reject(new Error(this.putFailure))
    if (this.hold) {
      const hold = deferred<void>()
      this.holds.push(hold)
      return hold.promise.then(() => { this.copies.set(snapshot.sessionId, snapshot) })
    }
    this.copies.set(snapshot.sessionId, snapshot)
    return Promise.resolve()
  })
  remove = vi.fn(async (sessionId: string) => { this.copies.delete(sessionId) })
  close = vi.fn(() => { this.closed = true })
}

type ReadResult = Awaited<ReturnType<WritingTransport['read']>>
class ControlledTransport implements WritingTransport {
  events: string[] = []
  reads: { postId: string; result: ReturnType<typeof deferred<ReadResult>> }[] = []
  writes: { command: WritingCommand; result: ReturnType<typeof deferred<WritingFeedback>> }[] = []
  read = vi.fn((postId: string) => {
    this.events.push('read')
    const result = deferred<ReadResult>()
    this.reads.push({ postId, result })
    return result.promise
  })
  write = vi.fn((command: WritingCommand) => {
    this.events.push(command.intent)
    const result = deferred<WritingFeedback>()
    this.writes.push({ command, result })
    return result.promise
  })
  answerWrite(index: number, version = `v${index + 2}`) {
    const call = this.writes[index]
    call.result.resolve(success(call.command, version))
  }
  answerRead(index: number, value: WorkingCopy | null) {
    this.reads[index].result.resolve({ status: 'success', value })
  }
}

const sessions: WritingSession[] = []
function fixture(initial: WorkingCopy | null = null, isNew = initial === null, store = new MemoryRecovery(), transport = new ControlledTransport(), handleControlFlow?: (error: unknown) => boolean) {
  const session = new WritingSession({ postId: initial?.id ?? crypto.randomUUID(), isNew, initial, recovery: store, transport, handleControlFlow })
  sessions.push(session)
  return { session, store, transport }
}
async function flush() {
  for (let index = 0; index < 30; index++) await Promise.resolve()
}
async function start(f: ReturnType<typeof fixture>, current: WorkingCopy | null = f.session.getSnapshot().remote) {
  const started = f.session.start()
  await flush()
  expect(f.transport.reads).toHaveLength(1)
  f.transport.answerRead(0, current)
  await started
  await flush()
}
async function pause() {
  await vi.advanceTimersByTimeAsync(1000)
  await flush()
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.useRealTimers()
})

describe('恢复边界回归', () => {
  it('新稿清空输入后仍能发现带未确认发布请求的恢复副本', async () => {
    const postId = crypto.randomUUID()
    const pending: WritingCommand = { postId, operationId: crypto.randomUUID(), expectedVersion: null, intent: 'publish', content: text('已提交正文') }
    const copy = recovery({ postId, content: blank(), pending })
    const store = new MemoryRecovery()
    store.copies.set(copy.sessionId, copy)
    const f = fixture(null, true, store)
    await start(f)
    expect(f.session.getSnapshot().candidates).toEqual([copy])
  })

  it('本机失败但服务器已同步后，重试仍重新持久化本机快照', async () => {
    const f = fixture(working())
    await start(f)
    f.store.putFailure = 'quota'
    f.session.edit(text('已同步但缺本机副本'))
    f.session.submit('save')
    await flush()
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'synced', localStatus: 'failed' })
    const before = f.store.puts.length
    f.store.putFailure = null
    const retrying = f.session.retry()
    await flush()
    f.transport.answerRead(1, f.session.getSnapshot().remote)
    await retrying
    expect(f.store.puts.length).toBeGreaterThan(before)
    expect(f.session.getSnapshot()).toMatchObject({ localStatus: 'saved', localError: null, shouldWarn: false })
  })

  it('未知响应状态是无法确认，不能丢弃原操作身份', async () => {
    const f = fixture(working())
    await start(f)
    f.session.submit('save')
    await flush()
    const pending = f.session.getSnapshot().pending
    // @ts-expect-error 外部协议损坏不受 TypeScript 返回类型约束。
    f.transport.writes[0].result.resolve({ status: 'future-protocol-status' })
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'error', pending })
  })
})

describe('独立身份、快照与启动', () => {
  it('每次构造分配不同会话，新稿空白无写入、无离开警告，快照及订阅稳定', async () => {
    const f = fixture()
    const other = fixture()
    expect(f.session.getSnapshot().sessionId).not.toBe(other.session.getSnapshot().sessionId)
    expect(f.session.getSnapshot().content).toEqual(blank())
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
    const initial = f.session.getSnapshot()
    expect(f.session.getSnapshot()).toBe(initial)
    const listener = vi.fn()
    const unsubscribe = f.session.subscribe(listener)
    f.session.edit(blank())
    expect(listener).not.toHaveBeenCalled()
    await start(f)
    const ready = f.session.getSnapshot()
    const count = listener.mock.calls.length
    await f.session.start()
    f.session.edit(blank())
    expect(f.session.getSnapshot()).toBe(ready)
    expect(listener).toHaveBeenCalledTimes(count)
    expect(f.store.puts).toEqual([])
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    unsubscribe()
    f.session.edit(text())
    expect(listener).toHaveBeenCalledTimes(count)
  })

  it('先列出候选，再检查服务器，候选未处理时不自动同步', async () => {
    const store = new MemoryRecovery()
    const copy = recovery()
    store.copies.set(copy.sessionId, copy)
    const list = deferred<RecoveryCopy[]>()
    store.list.mockImplementationOnce(() => list.promise)
    const f = fixture(null, true, store)
    const started = f.session.start()
    f.session.edit(text('当前输入'))
    await pause()
    expect(f.transport.read).not.toHaveBeenCalled()
    list.resolve([copy])
    await flush()
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    f.transport.answerRead(0, null)
    await started
    expect(f.session.getSnapshot().candidates).toEqual([copy])
    expect(f.transport.write).not.toHaveBeenCalled()
    const skipped = f.session.skipRecovery()
    await flush()
    expect(f.transport.writes[0].command.content.body).toBe('当前输入')
    f.transport.answerWrite(0)
    await skipped
    expect(store.copies.has(copy.sessionId)).toBe(true)
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('已有稿候选按文档和各自基线筛选，其他标签的已同步副本不阻塞', async () => {
    const initial = working()
    const command: WritingCommand = { postId: initial.id, operationId: crypto.randomUUID(), expectedVersion: initial.version, intent: 'autosave', content: text() }
    const clean = recovery({ postId: initial.id, isNew: false, content: text(), remote: initial })
    const pending = recovery({ ...clean, sessionId: crypto.randomUUID(), pending: command })
    const dirty = recovery({ ...clean, sessionId: crypto.randomUUID(), content: text('未同步') })
    const unrelated = recovery({ isNew: false })
    const store = new MemoryRecovery()
    for (const copy of [clean, pending, dirty, unrelated]) store.copies.set(copy.sessionId, copy)
    const f = fixture(initial, false, store)
    await start(f)
    expect(f.session.getSnapshot().candidates.map(copy => copy.sessionId)).toEqual([pending.sessionId, dirty.sessionId])
    expect(store.list).toHaveBeenCalledWith(initial.id)
  })

  it('新稿列表包含已自动同步但尚未明确 save 的非空副本', async () => {
    const remote = working()
    const auto = recovery({ postId: remote.id, content: text(), remote })
    const saved = recovery({ isNew: false })
    const empty = recovery({ content: blank() })
    const store = new MemoryRecovery()
    for (const copy of [auto, saved, empty]) store.copies.set(copy.sessionId, copy)
    const f = fixture(null, true, store)
    await start(f)
    expect(f.session.getSnapshot().candidates).toEqual([auto])
    expect(store.list).toHaveBeenCalledWith(undefined)
  })

  it('损坏列表明确失败并阻止远端检查和写入，显式跳过保留错误和旧副本', async () => {
    const store = new MemoryRecovery()
    store.listFailure = '恢复副本损坏'
    const f = fixture(null, true, store)
    await f.session.start()
    f.session.edit(text())
    await pause()
    expect(f.session.getSnapshot()).toMatchObject({ localStatus: 'failed', localError: '恢复副本损坏' })
    expect(f.transport.read).not.toHaveBeenCalled()
    expect(f.transport.write).not.toHaveBeenCalled()
    const skipping = f.session.skipRecovery()
    await flush()
    f.transport.answerRead(0, null)
    await flush()
    f.transport.answerWrite(0)
    await skipping
    expect(f.session.getSnapshot().localError).toBe('恢复副本损坏')
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('列表失败可以 retry，不能把损坏对象当成空候选', async () => {
    const store = new MemoryRecovery()
    store.list.mockResolvedValueOnce([Object.assign(recovery(), { format: 'unknown' })])
    const f = fixture(null, true, store)
    await f.session.start()
    expect(f.session.getSnapshot().localStatus).toBe('failed')
    expect(f.transport.read).not.toHaveBeenCalled()
    const retrying = f.session.retry()
    await flush()
    f.transport.answerRead(0, null)
    await retrying
    expect(f.session.getSnapshot().localError).toBeNull()
    expect(store.list).toHaveBeenCalledTimes(2)
  })

  it('start 检查期间的输入不被远端覆盖，版本不同进入冲突', async () => {
    const initial = working()
    const f = fixture(initial)
    const started = f.session.start()
    await flush()
    f.session.edit(text('读请求期间输入'))
    const other = working(initial.id, 'other', text('其他标签'))
    f.transport.answerRead(0, other)
    await started
    expect(f.session.getSnapshot()).toMatchObject({
      content: text('读请求期间输入'), remote: initial, conflict: { current: other }, syncStatus: 'conflict',
    })
    await pause()
    expect(f.transport.write).not.toHaveBeenCalled()
  })

  it('没有初始基线的已有稿只在无编辑时由首次读取初始化', async () => {
    const f = fixture(null, false)
    const started = f.session.start()
    await flush()
    const current = working(f.session.getSnapshot().postId)
    f.transport.answerRead(0, current)
    await started
    expect(f.session.getSnapshot()).toMatchObject({ content: text(), remote: current, shouldWarn: false })
    const g = fixture(null, false)
    const loading = g.session.start()
    await flush()
    g.session.edit(text('本机'))
    g.transport.answerRead(0, working(g.session.getSnapshot().postId))
    await loading
    expect(g.session.getSnapshot()).toMatchObject({ content: text('本机'), syncStatus: 'conflict' })
  })
})

describe('停笔、本机副本与单写队列', () => {
  it('持续输入每次立即保存本机，只在最后停笔 1000ms 后自动同步，空标题合法', async () => {
    const f = fixture()
    await start(f)
    for (const body of ['一', '二', '三']) {
      f.session.edit(text(body, ''))
      expect(f.store.puts.at(-1)?.content).toEqual(text(body, ''))
      await vi.advanceTimersByTimeAsync(900)
    }
    expect(f.transport.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(99)
    expect(f.transport.write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(f.transport.writes[0].command).toMatchObject({ intent: 'autosave', content: text('三', '') })
    const persisted = f.store.puts.find(copy => copy.pending !== null)
    expect(persisted?.pending).toEqual(f.transport.writes[0].command)
    expect(Object.isFrozen(f.transport.writes[0].command)).toBe(true)
    expect(Object.isFrozen(f.transport.writes[0].command.content)).toBe(true)
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ isNew: true, syncStatus: 'synced', shouldWarn: false })
    expect(f.store.copies.get(f.session.getSnapshot().sessionId)?.isNew).toBe(true)
  })

  it('本机旧写完成不能声称新输入已经保存', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    f.session.edit(text('旧'))
    f.session.edit(text('新'))
    expect(f.store.holds).toHaveLength(2)
    f.store.holds[0].resolve()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ content: text('新'), localStatus: 'saving', shouldWarn: true })
    f.store.holds[1].resolve()
    await flush()
    expect(f.session.getSnapshot().localStatus).toBe('saved')
    expect(f.session.getSnapshot().shouldWarn).toBe(true)
  })

  it('服务器发送前等待 pending 持久化，输入仍然可写', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('A'))
    await flush()
    f.store.hold = true
    await pause()
    expect(f.session.getSnapshot().pending?.content).toEqual(text('A'))
    expect(f.transport.write).not.toHaveBeenCalled()
    f.session.edit(text('B'))
    f.store.holds[0].resolve()
    await flush()
    expect(f.transport.writes[0].command.content).toEqual(text('A'))
    expect(f.session.getSnapshot().content).toEqual(text('B'))
  })

  it('本机写失败仍可同步服务器，失败状态和离开警告明确保留', async () => {
    const f = fixture()
    await start(f)
    f.store.putFailure = '磁盘不可用'
    f.session.edit(text())
    await pause()
    expect(f.transport.writes).toHaveLength(1)
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'synced', localStatus: 'failed', localError: '磁盘不可用', shouldWarn: true })
    f.store.putFailure = null
    f.session.edit(text('继续'))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ localStatus: 'saved', localError: null })
  })

  it('本机旧失败不污染已经确认的新快照', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    f.session.edit(text('旧'))
    f.session.edit(text('新'))
    f.store.holds[1].resolve()
    await flush()
    f.store.holds[0].reject(new Error('旧写失败'))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ localStatus: 'saved', localError: null, content: text('新') })
  })

  it('自动写进行时，手动优先并捕获点击内容，旧 ACK 只推进 remote', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('A'))
    await pause()
    f.session.edit(text('点击稿'))
    f.session.submit('publish')
    expect(f.session.getSnapshot().manualBusy).toBe(true)
    f.session.edit(text('继续写'))
    await pause()
    expect(f.transport.writes).toHaveLength(1)
    f.transport.answerWrite(0, 'auto-ack')
    await flush()
    expect(f.session.getSnapshot().content).toEqual(text('继续写'))
    expect(f.transport.writes[1].command).toMatchObject({ intent: 'publish', expectedVersion: 'auto-ack', content: text('点击稿') })
    expect(f.transport.writes).toHaveLength(2)
    f.transport.answerWrite(1, 'manual-ack')
    await flush()
    expect(f.transport.writes[2].command).toMatchObject({ intent: 'autosave', expectedVersion: 'manual-ack', content: text('继续写') })
    expect(f.session.getSnapshot()).toMatchObject({ isNew: false, manualBusy: false, content: text('继续写') })
    f.transport.answerWrite(2)
    await flush()
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
  })

  it.each(['save', 'publish'] as const)('%s 先使用契约校验，不阻碍空标题自动写', async intent => {
    const f = fixture()
    await start(f)
    f.session.edit(text('未完成', '  '))
    f.session.submit(intent)
    expect(f.session.getSnapshot().feedback).toMatchObject({ status: 'invalid', message: 'Enter a title.' })
    expect(f.session.getSnapshot().manualBusy).toBe(false)
    await pause()
    expect(f.transport.writes[0].command.intent).toBe('autosave')
  })

  it('明确 save 成功才退出 new 身份，自动写不会退出', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    f.session.submit('save')
    await flush()
    expect(f.session.getSnapshot().isNew).toBe(true)
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ isNew: false, manualBusy: false, shouldWarn: false })
    expect(f.store.puts.at(-1)?.isNew).toBe(false)
  })
})

describe('结果未知、重放与远端检查', () => {
  it.each(['reject', 'authorization'] as const)('%s 保留原 pending，重放确认后必须先 read 再发送较晚文本', async mode => {
    const f = fixture()
    await start(f)
    f.session.edit(text('原请求'))
    await pause()
    const original = structuredClone(f.transport.writes[0].command)
    if (mode === 'reject') f.transport.writes[0].result.reject(new Error('连接断开'))
    else f.transport.writes[0].result.resolve({ status: 'error', message: '请登录', signInRequired: true })
    await flush()
    expect(f.session.getSnapshot().pending).toEqual(original)
    expect(f.session.getSnapshot().signInRequired).toBe(mode === 'authorization')
    f.session.edit(text('较晚文本'))
    await pause()
    expect(f.transport.writes).toHaveLength(1)
    const retrying = f.session.retry()
    await flush()
    expect(f.transport.writes[1].command).toEqual(original)
    expect(f.transport.reads).toHaveLength(1)
    f.transport.answerWrite(1, 'confirmed')
    await flush()
    expect(f.transport.reads).toHaveLength(2)
    expect(f.transport.writes).toHaveLength(2)
    const confirmed = working(original.postId, 'confirmed', original.content)
    f.transport.answerRead(1, confirmed)
    await flush()
    expect(f.transport.events).toEqual(['read', 'autosave', 'autosave', 'read', 'autosave'])
    expect(f.transport.writes[2].command).toMatchObject({ content: text('较晚文本'), expectedVersion: 'confirmed' })
    expect(f.transport.writes[2].command.operationId).not.toBe(original.operationId)
    f.transport.answerWrite(2)
    await retrying
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
  })

  it('重放原 ACK 后如果另一个标签已更新则冲突，不提交较晚文本', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('A'))
    await pause()
    f.transport.writes[0].result.reject(new Error('响应丢失'))
    await flush()
    f.session.edit(text('本机后来'))
    await pause()
    const retrying = f.session.retry()
    await flush()
    f.transport.answerWrite(1, 'receipt-version')
    await flush()
    const other = working(f.session.getSnapshot().postId, 'other-tab', text('其他标签'))
    f.transport.answerRead(1, other)
    await retrying
    expect(f.session.getSnapshot()).toMatchObject({ content: text('本机后来'), remote: { version: 'receipt-version' }, conflict: { current: other } })
    expect(f.transport.writes).toHaveLength(2)
  })

  it('无 pending 的重连也先 read，读取拒绝不改基线、不写入', async () => {
    const initial = working()
    const f = fixture(initial)
    await start(f)
    f.session.edit(text('离线输入'))
    const retrying = f.session.retry()
    await flush()
    expect(f.transport.writes).toEqual([])
    f.transport.reads[1].result.reject(new Error('仍然离线'))
    await retrying
    expect(f.session.getSnapshot()).toMatchObject({ remote: initial, content: text('离线输入'), syncStatus: 'error' })
    expect(f.transport.writes).toEqual([])
  })

  it('已知 invalid 清理 pending，不自动重试同一文本，修改后可再写', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    await pause()
    f.transport.writes[0].result.resolve({ status: 'invalid', message: '定性拒绝' })
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ pending: null, syncStatus: 'invalid' })
    await pause()
    const retrying = f.session.retry()
    await flush()
    f.transport.answerRead(1, null)
    await retrying
    expect(f.transport.writes).toHaveLength(1)
    f.session.edit(text('修改后'))
    await pause()
    expect(f.transport.writes).toHaveLength(2)
  })

  it('已有文档消失时不能把 expectedVersion=null 当新稿重建', async () => {
    const initial = working()
    const f = fixture(initial)
    await start(f, null)
    f.session.edit(text('保留内容'))
    await pause()
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'missing', remote: initial, content: text('保留内容') })
    await f.session.useServer()
    expect(f.session.getSnapshot().feedback).toMatchObject({ status: 'error' })
    expect(f.transport.write).not.toHaveBeenCalled()
  })
})

describe('恢复与冲突分支', () => {
  it('恢复保留当前输入和原副本，复制旧文档身份、基线和固定请求到新 session', async () => {
    const baseline = working()
    const pending: WritingCommand = {
      intent: 'save', postId: baseline.id, operationId: crypto.randomUUID(), expectedVersion: baseline.version, content: text('原请求'),
    }
    const copy = recovery({ postId: baseline.id, isNew: true, content: text('恢复时较晚输入'), remote: baseline, pending })
    const f = fixture()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    f.session.edit(text('当前入口输入'))
    const previousSession = f.session.getSnapshot().sessionId
    const restoring = f.session.recover(copy)
    await flush()
    const restored = f.session.getSnapshot()
    expect(restored.sessionId).not.toBe(previousSession)
    expect(restored.sessionId).not.toBe(copy.sessionId)
    expect(restored).toMatchObject({ postId: baseline.id, isNew: true, content: copy.content, remote: baseline, pending })
    expect(f.store.copies.get(previousSession)?.content).toEqual(text('当前入口输入'))
    expect(f.store.copies.get(copy.sessionId)).toEqual(copy)
    expect(f.store.puts.find(value => value.sessionId === restored.sessionId)).toMatchObject({
      sessionId: restored.sessionId, postId: copy.postId, isNew: copy.isNew,
      content: copy.content, remote: copy.remote, pending: copy.pending,
    })
    expect(f.transport.writes[0].command).toEqual(pending)
    expect(f.transport.reads).toHaveLength(1)
    f.transport.answerWrite(0, 'confirmed')
    await flush()
    expect(f.transport.reads[1].postId).toBe(baseline.id)
    f.transport.answerRead(1, { ...baseline, ...pending.content, version: 'confirmed', checkpointRevisionId: 1 })
    await flush()
    expect(f.transport.writes[1].command).toMatchObject({ intent: 'autosave', postId: baseline.id, expectedVersion: 'confirmed', content: copy.content })
    f.transport.answerWrite(1)
    await restoring
    expect(f.session.getSnapshot().isNew).toBe(false)
    expect(f.store.copies.get(copy.sessionId)).toEqual(copy)
  })

  it('恢复历史非 UUID 文档 ID 不换文档，只新建本机会话键', async () => {
    const baseline = working('legacy-post-id')
    const copy = recovery({ postId: baseline.id, isNew: false, content: text('旧稿未同步'), remote: baseline })
    const f = fixture()
    await start(f)
    const restoring = f.session.recover(copy)
    await flush()
    expect(f.transport.reads[1].postId).toBe('legacy-post-id')
    f.transport.answerRead(1, baseline)
    await flush()
    expect(f.transport.writes[0].command).toMatchObject({ postId: 'legacy-post-id', expectedVersion: baseline.version, content: copy.content })
    expect(f.session.getSnapshot().sessionId).not.toBe(copy.sessionId)
    f.transport.answerWrite(0)
    await restoring
    expect(f.session.getSnapshot().postId).toBe('legacy-post-id')
  })

  it('恢复无 pending 的副本也先校验版本，远端已变则保留本机并冲突', async () => {
    const baseline = working()
    const copy = recovery({ postId: baseline.id, isNew: false, remote: baseline, content: text('本机分支') })
    const f = fixture()
    await start(f)
    const restoring = f.session.recover(copy)
    await flush()
    expect(f.transport.write).not.toHaveBeenCalled()
    const current = working(baseline.id, 'changed', text('服务器分支'))
    f.transport.answerRead(1, current)
    await restoring
    expect(f.session.getSnapshot()).toMatchObject({ content: copy.content, remote: baseline, conflict: { current } })
  })

  it('useServer 先保留本机分支，再更换 session 并选择服务器，不删除旧副本', async () => {
    const initial = working()
    const f = fixture(initial)
    await start(f)
    f.session.edit(text('本机分支'))
    await pause()
    const current = working(initial.id, 'other', text('服务器分支'))
    f.transport.writes[0].result.resolve({ status: 'conflict', current })
    await flush()
    const oldSession = f.session.getSnapshot().sessionId
    f.store.hold = true
    const selecting = f.session.useServer()
    await flush()
    expect(f.session.getSnapshot().sessionId).toBe(oldSession)
    f.session.edit(text('保留前继续输入'))
    f.store.holds[0].resolve()
    await flush()
    // 编辑副本和分支保留重试都必须完成，才能丢弃当前输入。
    expect(f.store.holds).toHaveLength(3)
    expect(f.session.getSnapshot().sessionId).toBe(oldSession)
    f.store.hold = false
    f.store.holds[1].resolve()
    f.store.holds[2].resolve()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ content: text('服务器分支'), remote: current, pending: null })
    expect(f.session.getSnapshot().sessionId).not.toBe(oldSession)
    expect(f.store.copies.get(oldSession)?.content).toEqual(text('保留前继续输入'))
    f.transport.answerRead(1, current)
    await selecting
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
    expect(f.store.remove).not.toHaveBeenCalled()
  })

  it('本机分支保留失败时，useServer 不切换身份也不丢弃输入', async () => {
    const initial = working()
    const f = fixture(initial)
    const current = working(initial.id, 'other')
    await start(f, current)
    f.session.edit(text('必须保留'))
    const before = f.session.getSnapshot().sessionId
    f.store.putFailure = '空间不足'
    await f.session.useServer()
    expect(f.session.getSnapshot()).toMatchObject({ sessionId: before, content: text('必须保留'), syncStatus: 'conflict', localStatus: 'failed' })
  })

  it('forkLocal 使用新文档和会话，保留输入、原 pending 和旧副本，旧 ACK 不落新稿', async () => {
    const initial = working()
    const f = fixture(initial)
    await start(f)
    f.session.edit(text('待确认输入'))
    await pause()
    const oldSession = f.session.getSnapshot().sessionId
    const original = structuredClone(f.session.getSnapshot().pending)
    const forking = f.session.forkLocal()
    await flush()
    const forked = f.session.getSnapshot()
    expect(forked.postId).not.toBe(initial.id)
    expect(forked.sessionId).not.toBe(oldSession)
    expect(forked).toMatchObject({ content: text('待确认输入'), remote: null, pending: null, isNew: true })
    expect(f.store.copies.get(oldSession)?.pending).toEqual(original)
    expect(f.transport.reads).toHaveLength(1)
    f.transport.answerWrite(0, 'old-document-ack')
    await flush()
    expect(f.session.getSnapshot().remote).toBeNull()
    expect(f.transport.reads[1].postId).toBe(forked.postId)
    f.transport.answerRead(1, null)
    await flush()
    expect(f.transport.writes[1].command).toMatchObject({ postId: forked.postId, expectedVersion: null, content: text('待确认输入') })
    f.transport.answerWrite(1, 'new-document-ack')
    await forking
    expect(f.session.getSnapshot().remote?.id).toBe(forked.postId)
    expect(f.store.copies.get(oldSession)?.pending).toEqual(original)
  })

  it('显式 skipRecovery 不用候选覆盖当前输入，也不删除候选', async () => {
    const f = fixture()
    const copy = recovery()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    const identity = f.session.getSnapshot().postId
    const skipping = f.session.skipRecovery()
    await skipping
    expect(f.session.getSnapshot()).toMatchObject({ postId: identity, content: blank(), candidates: [], shouldWarn: false })
    expect(f.store.copies.get(copy.sessionId)).toEqual(copy)
    expect(f.store.puts).toEqual([])
  })
})

describe('跨标签与 UI 状态契约', () => {
  it('两个标签各写自己的恢复键，只有先提交者推进版本，后提交者保留输入并冲突', async () => {
    const initial = working()
    const first = fixture(initial)
    const second = fixture(initial)
    await start(first)
    await start(second)
    first.session.edit(text('标签一'))
    second.session.edit(text('标签二'))
    await pause()
    first.transport.answerWrite(0, 'first-tab-version')
    await flush()
    const current = first.session.getSnapshot().remote
    second.transport.writes[0].result.resolve({ status: 'conflict', current })
    await flush()
    expect(second.session.getSnapshot()).toMatchObject({ content: text('标签二'), remote: initial, conflict: { current }, pending: null })
    expect(first.session.getSnapshot().sessionId).not.toBe(second.session.getSnapshot().sessionId)
    expect(first.store.copies.get(first.session.getSnapshot().sessionId)?.content).toEqual(text('标签一'))
    expect(second.store.copies.get(second.session.getSnapshot().sessionId)?.content).toEqual(text('标签二'))
    const retrying = second.session.retry()
    await flush()
    second.transport.answerRead(1, current)
    await retrying
    expect(second.transport.writes).toHaveLength(1)
  })

  it.each(['autosave', 'save', 'publish'] as const)('lastConfirmed 精确记录 %s 的请求和内容，继续编辑不伪造新确认', async intent => {
    const f = fixture()
    await start(f)
    f.session.edit(text('已提交快照'))
    if (intent === 'autosave') await pause()
    else {
      f.session.submit(intent)
      await flush()
    }
    const original = f.transport.writes[0].command
    f.session.edit(text('继续输入'))
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot().lastConfirmed).toEqual({ intent, content: text('已提交快照'), operationId: original.operationId })
    expect(f.session.getSnapshot().content).toEqual(text('继续输入'))
  })

  it('客户端标题校验不能抹去服务端尚未解决的登录需求', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    await pause()
    f.transport.writes[0].result.resolve({ status: 'error', message: '需要登录', signInRequired: true })
    await flush()
    f.session.edit(text('继续输入', ''))
    f.session.submit('save')
    expect(f.session.getSnapshot()).toMatchObject({ signInRequired: true, feedback: { status: 'invalid' } })
    expect(f.session.getSnapshot().pending).toEqual(f.transport.writes[0].command)
  })

  it('分支切换保留尚未编辑过的初始内容，useServer 的 new 身份有独立副本', async () => {
    const initial = working()
    const f = fixture(initial, true)
    const current = working(initial.id, 'other', text('另一个版本'))
    await start(f, current)
    const oldSession = f.session.getSnapshot().sessionId
    const selecting = f.session.useServer()
    await flush()
    const selected = f.session.getSnapshot()
    expect(f.store.copies.get(oldSession)?.content).toEqual(text())
    expect(f.store.copies.get(selected.sessionId)).toMatchObject({ isNew: true, content: text('另一个版本'), remote: current })
    f.transport.answerRead(1, current)
    await selecting
    expect(selected.sessionId).not.toBe(oldSession)
  })

  it('只删除当前候选，删完后仍需显式 skipRecovery 开启同步', async () => {
    const f = fixture()
    const copy = recovery()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    f.session.edit(text('当前输入'))
    await pause()
    await f.session.discardRecovery(crypto.randomUUID())
    await f.session.discardRecovery(f.session.getSnapshot().sessionId)
    expect(f.store.remove).not.toHaveBeenCalled()
    await f.session.discardRecovery(copy.sessionId)
    expect(f.store.remove).toHaveBeenCalledExactlyOnceWith(copy.sessionId)
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [], syncStatus: 'recovery', content: text('当前输入') })
    expect(f.transport.writes).toHaveLength(0)
    const skipping = f.session.skipRecovery()
    await flush()
    expect(f.transport.writes[0].command.content).toEqual(text('当前输入'))
    f.transport.answerWrite(0)
    await skipping
  })

  it('删除候选失败保留候选和 localError，后续 edit 的成功 put 不会抹去删除错误', async () => {
    const f = fixture()
    const copy = recovery()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    f.store.remove.mockRejectedValueOnce(new Error('删除失败'))
    await f.session.discardRecovery(copy.sessionId)
    f.session.edit(text('当前输入'))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [copy], localStatus: 'failed', localError: '删除失败' })
    expect(f.store.copies.has(copy.sessionId)).toBe(true)
    await f.session.discardRecovery(copy.sessionId)
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [], localError: null, syncStatus: 'recovery' })
  })
})

describe('框架控制流的端口交接', () => {
  it('read 特殊 signal 只交给 UI，队列暂停，不变普通失败或未处理拒绝', async () => {
    const signal = { redirect: '/login' }
    const boundary = vi.fn()
    const hook = vi.fn((error: unknown) => {
      if (error !== signal) return false
      boundary(error)
      return true
    })
    const f = fixture(null, true, new MemoryRecovery(), new ControlledTransport(), hook)
    const starting = f.session.start()
    await flush()
    f.transport.reads[0].result.reject(signal)
    await starting
    expect(boundary).toHaveBeenCalledExactlyOnceWith(signal)
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'interrupted', feedback: null, pending: null })
    f.session.edit(text())
    await pause()
    expect(f.transport.writes).toHaveLength(0)
    const retrying = f.session.retry()
    await flush()
    f.transport.answerRead(1, null)
    await flush()
    f.transport.answerWrite(0)
    await retrying
    expect(f.session.getSnapshot().syncStatus).toBe('synced')
  })

  it('后台 write 特殊 signal 保留固定请求，retry 先重放再 read，不抛出后台拒绝', async () => {
    const signal = { navigation: 'refresh' }
    const boundary = vi.fn()
    const f = fixture(null, true, new MemoryRecovery(), new ControlledTransport(), error => {
      if (error !== signal) return false
      boundary(error)
      return true
    })
    await start(f)
    f.session.edit(text())
    await pause()
    const original = structuredClone(f.transport.writes[0].command)
    f.transport.writes[0].result.reject(signal)
    await flush()
    expect(boundary).toHaveBeenCalledExactlyOnceWith(signal)
    expect(f.session.getSnapshot()).toMatchObject({ syncStatus: 'interrupted', feedback: null, pending: original, shouldWarn: true })
    const retrying = f.session.retry()
    await flush()
    expect(f.transport.writes[1].command).toEqual(original)
    f.transport.answerWrite(1, 'confirmed')
    await flush()
    f.transport.answerRead(1, working(original.postId, 'confirmed', original.content))
    await retrying
    expect(f.session.getSnapshot().pending).toBeNull()
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
  })

  it('钩子不接管普通网络错误，dispose 后的晚到 signal 不再交接 UI', async () => {
    const boundary = vi.fn(() => false)
    const f = fixture(null, true, new MemoryRecovery(), new ControlledTransport(), boundary)
    const starting = f.session.start()
    await flush()
    const error = new Error('普通网络错误')
    f.transport.reads[0].result.reject(error)
    await starting
    expect(boundary).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.session.getSnapshot().feedback).toMatchObject({ status: 'error', message: '普通网络错误' })
    const retrying = f.session.retry()
    await flush()
    f.session.dispose()
    f.transport.reads[1].result.reject({ redirect: '/late' })
    await retrying
    expect(boundary).toHaveBeenCalledTimes(1)
  })
})

describe('销毁与晚到结果', () => {
  it('读取收尾时订阅者重入切换分支，新分支的检查不会丢失调度', async () => {
    const initial = working()
    const f = fixture(initial)
    let selecting = Promise.resolve()
    let began = false
    f.session.subscribe(() => {
      if (f.session.getSnapshot().conflict && !began) {
        began = true
        selecting = f.session.useServer()
      }
    })
    const starting = f.session.start()
    await flush()
    const current = working(initial.id, 'other', text('新远端'))
    f.transport.answerRead(0, current)
    await flush()
    expect(f.transport.reads).toHaveLength(2)
    f.transport.answerRead(1, current)
    await starting
    await selecting
    expect(f.session.getSnapshot()).toMatchObject({ content: text('新远端'), remote: current, syncStatus: 'synced' })
  })

  it('分支保留失败不取消尚未发出的原请求，也不会另开第二条写队列', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    f.session.edit(text())
    await pause()
    expect(f.store.holds).toHaveLength(2)
    const identity = f.session.getSnapshot().postId
    const forking = f.session.forkLocal()
    await flush()
    expect(f.store.holds).toHaveLength(3)
    f.store.holds[0].resolve()
    f.store.holds[2].reject(new Error('保留失败'))
    await forking
    f.store.holds[1].resolve()
    await flush()
    expect(f.session.getSnapshot().postId).toBe(identity)
    expect(f.transport.writes).toHaveLength(1)
    expect(f.transport.writes[0].command.postId).toBe(identity)
  })

  it('dispose 取消定时器和通知，已接受本机写继续完成', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    const listener = vi.fn()
    f.session.subscribe(listener)
    f.session.edit(text())
    const count = listener.mock.calls.length
    f.session.dispose()
    f.session.dispose()
    f.store.holds[0].resolve()
    await pause()
    expect(f.store.copies.get(f.session.getSnapshot().sessionId)?.content).toEqual(text())
    expect(f.transport.write).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledTimes(count)
    expect(f.store.close).toHaveBeenCalledTimes(1)
    expect(f.session.getSnapshot().syncStatus).toBe('disposed')
    const snapshot = f.session.getSnapshot()
    f.session.edit(text('忽略'))
    await f.session.start()
    await f.session.retry()
    expect(f.session.getSnapshot()).toBe(snapshot)
  })

  it('销毁不取消服务端在途写，晚到 ACK 不通知、不调度排队手动或自动写', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('A'))
    await pause()
    f.session.edit(text('B'))
    f.session.submit('publish')
    const listener = vi.fn()
    f.session.subscribe(listener)
    f.session.dispose()
    const puts = f.store.puts.length
    f.transport.answerWrite(0)
    await pause()
    expect(f.transport.writes).toHaveLength(1)
    expect(f.store.puts).toHaveLength(puts)
    expect(listener).not.toHaveBeenCalled()
    expect(f.session.getSnapshot().pending?.content).toEqual(text('A'))
  })

  it('start 的晚到读取在 dispose 后不改快照或发起请求', async () => {
    const f = fixture()
    const starting = f.session.start()
    await flush()
    f.session.dispose()
    const snapshot = f.session.getSnapshot()
    f.transport.answerRead(0, working(f.session.getSnapshot().postId))
    await starting
    expect(f.session.getSnapshot()).toBe(snapshot)
    expect(f.transport.write).not.toHaveBeenCalled()
  })
})
