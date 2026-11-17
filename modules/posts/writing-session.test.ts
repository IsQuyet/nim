// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WritingSession } from './writing-session'
import type { DraftPost, PostContent } from './model'
import type { OperationIdentity, ReceiptFeedback, RecoveryCopy, RecoveryStore, WritingCommand, WritingFeedback, WritingTransport } from './writing'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const date = '2026-11-15T00:00:00.000Z'
const text = (body = '正文', title = '标题'): PostContent => ({ title, description: '', body })
const blank = (): PostContent => ({ title: '', description: '', body: '' })
function draft(id: string = crypto.randomUUID(), revisionId = 1, content = text()): DraftPost {
  return { id, revisionId, ...content, createdAt: date, updatedAt: date }
}
function recovery(input: Partial<RecoveryCopy> = {}): RecoveryCopy {
  return {
    format: 'nim-recovery/v2', sessionId: crypto.randomUUID(), postId: crypto.randomUUID(),
    content: text(), remote: null, pending: null, updatedAt: date, ...input,
  }
}
function command(remote: DraftPost | null, postId = remote?.id ?? crypto.randomUUID()): WritingCommand {
  return { postId, operationId: crypto.randomUUID(), expectedRevisionId: remote?.revisionId ?? null, intent: 'save', content: text('原请求') }
}
function success(command: WritingCommand, revisionId = 2): Extract<WritingFeedback, { status: 'success' }> {
  return {
    status: 'success', value: {
      draft: draft(command.postId, revisionId, command.content),
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
  inspections: { operation: OperationIdentity; result: ReturnType<typeof deferred<ReceiptFeedback>> }[] = []
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
  inspect = vi.fn((operation: OperationIdentity) => {
    this.events.push('inspect')
    const result = deferred<ReceiptFeedback>()
    this.inspections.push({ operation, result })
    return result.promise
  })
  answerWrite(index: number, revisionId = index + 2) {
    const call = this.writes[index]
    call.result.resolve(success(call.command, revisionId))
  }
  answerRead(index: number, value: DraftPost | null) {
    this.reads[index].result.resolve({ status: 'success', value })
  }
}

const sessions: WritingSession[] = []
function fixture(initial: DraftPost | null = null, store = new MemoryRecovery(), transport = new ControlledTransport(), handleControlFlow?: (error: unknown) => boolean) {
  const session = new WritingSession({ postId: initial?.id ?? crypto.randomUUID(), initial, recovery: store, transport, handleControlFlow })
  sessions.push(session)
  return { session, store, transport }
}
type Fixture = ReturnType<typeof fixture>
async function flush() {
  for (let index = 0; index < 40; index++) await Promise.resolve()
}
async function start(f: Fixture, current: DraftPost | null = f.session.getSnapshot().remote) {
  const started = f.session.start()
  await flush()
  expect(f.transport.reads).toHaveLength(1)
  f.transport.answerRead(0, current)
  await started
  await flush()
  expect(f.transport.write).not.toHaveBeenCalled()
}
async function pauseWithoutWrites(f: Fixture, expected = 0) {
  await vi.advanceTimersByTimeAsync(60_000)
  await flush()
  expect(f.transport.write).toHaveBeenCalledTimes(expected)
}
async function makeUnknown(f: Fixture) {
  f.session.edit(text('原请求'))
  f.session.submit('save')
  await flush()
  const original = f.transport.writes[0].command
  f.transport.writes[0].result.reject(new Error('响应丢失'))
  await flush()
  return original
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('独立身份、稳定快照与只读启动', () => {
  it('每次 mount 分配独立会话，空白启动、任意停顿均不写服务器，快照稳定冻结', async () => {
    const f = fixture()
    const other = fixture()
    const initial = f.session.getSnapshot()
    expect(initial).toMatchObject({ isNew: true, content: blank(), serverStatus: 'idle', shouldWarn: false })
    expect(initial.sessionId).not.toBe(other.session.getSnapshot().sessionId)
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.content)).toBe(true)
    expect(Object.isFrozen(initial.candidates)).toBe(true)
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
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    await pauseWithoutWrites(f)
    unsubscribe()
    f.session.edit(text())
    expect(listener).toHaveBeenCalledTimes(count)
  })

  it('先 list 再 read，候选在远端挂起时已经可见，未处理候选不能提交', async () => {
    const store = new MemoryRecovery()
    const copy = recovery()
    const listing = deferred<RecoveryCopy[]>()
    store.list.mockImplementationOnce(() => listing.promise)
    const f = fixture(null, store)
    const starting = f.session.start()
    f.session.edit(text('当前输入'))
    await pauseWithoutWrites(f)
    expect(f.transport.read).not.toHaveBeenCalled()
    listing.resolve([copy])
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [copy], recoveryRequired: true, serverStatus: 'checking' })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    f.session.submit('save')
    await pauseWithoutWrites(f)
    f.transport.reads[0].result.reject(new Error('离线'))
    await starting
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [copy], recoveryRequired: true })
    await f.session.skipRecovery()
    await pauseWithoutWrites(f)
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('已有稿候选按各副本自己的基线筛选，不接管其他标签的恢复键', async () => {
    const initial = draft()
    const clean = recovery({ postId: initial.id, content: text(), remote: initial })
    const unknown = recovery({ ...clean, sessionId: crypto.randomUUID(), pending: command(initial) })
    const dirty = recovery({ ...clean, sessionId: crypto.randomUUID(), content: text('未明确保存') })
    const local = recovery({ postId: initial.id, content: text('本机分支') })
    const blankLocal = recovery({ postId: initial.id, content: blank() })
    const unrelated = recovery()
    const store = new MemoryRecovery()
    for (const copy of [clean, unknown, dirty, local, blankLocal, unrelated]) store.copies.set(copy.sessionId, copy)
    const f = fixture(initial, store)
    await start(f)
    expect(f.session.getSnapshot().candidates).toEqual([unknown, dirty, local, blankLocal])
    expect(store.list).toHaveBeenCalledWith(initial.id)
    expect(f.session.getSnapshot().sessionId).not.toBe(clean.sessionId)
    await pauseWithoutWrites(f)
  })

  it('新稿候选只取 remote=null 的非空副本或带明确 pending 的空副本', async () => {
    const emptyPending = command(null)
    const wanted = [recovery(), recovery({ postId: emptyPending.postId, content: blank(), pending: emptyPending })]
    const saved = draft()
    const excluded = [recovery({ postId: saved.id, remote: saved }), recovery({ content: blank() })]
    const store = new MemoryRecovery()
    for (const copy of [...wanted, ...excluded]) store.copies.set(copy.sessionId, copy)
    const f = fixture(null, store)
    await start(f)
    expect(f.session.getSnapshot().candidates).toEqual(wanted)
    expect(store.list).toHaveBeenCalledWith(undefined)
    await pauseWithoutWrites(f)
  })

  it('损坏列表独立阻止恢复闸门，read 挂起也显示本机失败，不删除原数据', async () => {
    const store = new MemoryRecovery()
    store.list.mockResolvedValueOnce([Object.assign(recovery(), { format: 'nim-recovery/v1' })])
    const f = fixture(null, store)
    const starting = f.session.start()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ recoveryRequired: true, localStatus: 'failed', shouldWarn: true })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    f.session.edit(text())
    f.session.submit('publish')
    await pauseWithoutWrites(f)
    f.transport.answerRead(0, null)
    await starting
    await f.session.skipRecovery()
    expect(f.session.getSnapshot()).toMatchObject({ recoveryRequired: false, localStatus: 'failed' })
    await pauseWithoutWrites(f)
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('retryLocal 重试本机列表与 put，不读取或写入服务器', async () => {
    const store = new MemoryRecovery()
    store.listFailure = '恢复副本损坏'
    const f = fixture(null, store)
    await start(f)
    const copy = recovery()
    store.copies.set(copy.sessionId, copy)
    store.listFailure = null
    await f.session.retryLocal()
    expect(store.list).toHaveBeenCalledTimes(2)
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [copy], recoveryRequired: true, localStatus: 'saved', localError: null })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    expect(f.transport.inspect).not.toHaveBeenCalled()
    await pauseWithoutWrites(f)
  })

  it('start 期间输入不被远端覆盖，不同修订进入 conflict', async () => {
    const initial = draft()
    const f = fixture(initial)
    const starting = f.session.start()
    await flush()
    f.session.edit(text('读请求期间输入'))
    const current = draft(initial.id, 2, text('其他标签'))
    f.transport.answerRead(0, current)
    await starting
    expect(f.session.getSnapshot()).toMatchObject({ content: text('读请求期间输入'), remote: initial, conflict: { current }, serverStatus: 'conflict' })
    await pauseWithoutWrites(f)
  })

  it('新稿 UUID 已被服务器占用时只报告冲突，不隐式接管服务器稿', async () => {
    const f = fixture()
    const current = draft(f.session.getSnapshot().postId)
    await start(f, current)
    expect(f.session.getSnapshot()).toMatchObject({ remote: null, content: blank(), isNew: true, conflict: { current } })
    f.session.submit('save')
    await pauseWithoutWrites(f)
  })
})

describe('本机即时保护与明确手动保存', () => {
  it('持续输入、空标题、原始空白与清空都立即保留，任意停顿绝不上传', async () => {
    const f = fixture()
    await start(f)
    for (const content of [text('一', ''), text('二\r\n  ', '  '), text('三', ''), blank()]) {
      f.session.edit(content)
      expect(f.store.puts.at(-1)?.content).toEqual(content)
      await vi.advanceTimersByTimeAsync(900)
    }
    await pauseWithoutWrites(f)
    expect(f.store.puts).toHaveLength(4)
    expect(f.store.puts.every(copy => copy.format === 'nim-recovery/v2' && copy.pending === null)).toBe(true)
    expect(f.session.getSnapshot()).toMatchObject({ content: blank(), localStatus: 'saved', serverStatus: 'idle', shouldWarn: false })
  })

  it.each(['save', 'publish'] as const)('%s 只提交点击快照，先落本机固定 pending，ACK 不覆盖较新输入', async intent => {
    const f = fixture()
    await start(f)
    f.session.edit(text('点击稿'))
    await flush()
    f.store.hold = true
    f.session.submit(intent)
    await flush()
    const pending = f.session.getSnapshot().pending
    expect(pending).toMatchObject({ intent, expectedRevisionId: null, content: text('点击稿') })
    expect(Object.isFrozen(pending)).toBe(true)
    expect(Object.isFrozen(pending?.content)).toBe(true)
    expect(f.store.puts.at(-1)?.pending).toEqual(pending)
    expect(f.transport.write).not.toHaveBeenCalled()
    f.session.edit(text('继续输入'))
    f.session.submit('save')
    f.store.holds[0].resolve()
    await flush()
    expect(f.transport.writes).toHaveLength(1)
    expect(f.transport.writes[0].command).toEqual(pending)
    expect(f.session.getSnapshot()).toMatchObject({ content: text('继续输入'), manualBusy: true, serverStatus: 'saving' })
    f.store.hold = false
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({
      isNew: false, remote: { revisionId: 2, ...text('点击稿') }, content: text('继续输入'),
      manualBusy: false, serverStatus: 'unsaved', pending: null,
      lastConfirmed: { intent, content: text('点击稿'), operationId: pending?.operationId, via: 'write' },
    })
    await pauseWithoutWrites(f, 1)
    expect(f.transport.inspect).not.toHaveBeenCalled()
  })

  it('初始只读检查与手动请求共用队列，连续按钮不重复提交，捕获按钮当时内容', async () => {
    const f = fixture()
    const starting = f.session.start()
    await flush()
    f.session.edit(text('点击时'))
    f.session.submit('publish')
    f.session.edit(text('后来'))
    f.session.submit('save')
    await flush()
    expect(f.transport.writes).toHaveLength(0)
    f.transport.answerRead(0, null)
    await flush()
    expect(f.transport.writes).toHaveLength(1)
    expect(f.transport.writes[0].command).toMatchObject({ intent: 'publish', content: text('点击时') })
    f.transport.answerWrite(0)
    await starting
    await pauseWithoutWrites(f, 1)
  })

  it.each(['save', 'publish'] as const)('%s 校验非空标题，但不丢弃本机空标题输入', async intent => {
    const f = fixture()
    await start(f)
    f.session.edit(text('未完成', '  '))
    f.session.submit(intent)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ feedback: { status: 'invalid', message: 'Enter a title.' }, manualBusy: false, content: text('未完成', '  ') })
    expect(f.store.puts.at(-1)?.content).toEqual(text('未完成', '  '))
    await pauseWithoutWrites(f)
  })

  it('本机失败不阻止明确服务器保存，确认后仍明确 failed 与警告，retryLocal 只重做本机 put', async () => {
    const f = fixture(draft())
    await start(f)
    f.store.putFailure = '空间不足'
    f.session.edit(text('明确保存'))
    f.session.submit('save')
    await flush()
    expect(f.transport.writes).toHaveLength(1)
    expect(f.session.getSnapshot().pending).toEqual(f.transport.writes[0].command)
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ serverStatus: 'saved', localStatus: 'failed', localError: '空间不足', shouldWarn: true })
    const count = f.store.puts.length
    f.store.putFailure = null
    await f.session.retryLocal()
    expect(f.store.puts).toHaveLength(count + 1)
    expect(f.session.getSnapshot()).toMatchObject({ localStatus: 'saved', localError: null, shouldWarn: false })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    expect(f.transport.inspect).not.toHaveBeenCalled()
    await pauseWithoutWrites(f, 1)
  })

  it('本机旧 put 完成不能宣称新文本已保存，旧失败也不能污染已保存的新快照', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    f.session.edit(text('旧'))
    f.session.edit(text('新'))
    f.store.holds[0].resolve()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ content: text('新'), localStatus: 'saving', shouldWarn: true })
    f.store.holds[1].resolve()
    await flush()
    expect(f.session.getSnapshot().localStatus).toBe('saved')
    f.session.edit(text('更旧'))
    f.session.edit(text('最新'))
    f.store.holds[3].resolve()
    await flush()
    f.store.holds[2].reject(new Error('旧写失败'))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ content: text('最新'), localStatus: 'saved', localError: null })
    await pauseWithoutWrites(f)
  })

  it('明确 invalid 清除已知被拒绝的 pending，不自动发送修改后的文本', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    f.session.submit('save')
    await flush()
    f.transport.writes[0].result.resolve({ status: 'invalid', message: '明确拒绝' })
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ pending: null, serverStatus: 'invalid', manualBusy: false })
    const checking = f.session.checkServer()
    await flush()
    f.transport.answerRead(1, null)
    await checking
    expect(f.session.getSnapshot()).toMatchObject({ serverStatus: 'invalid', feedback: { status: 'invalid' } })
    f.session.edit(text('修正内容'))
    await pauseWithoutWrites(f, 1)
    f.session.submit('save')
    await flush()
    expect(f.transport.writes).toHaveLength(2)
    expect(f.transport.writes[1].command.operationId).not.toBe(f.transport.writes[0].command.operationId)
  })
})

describe('未知结果、只读回执与明确重试', () => {
  it.each(['network', 'authorization', 'unknown', 'wrong-document', 'wrong-content', 'wrong-publication'] as const)('%s 保留原固定请求，新 submit 不能替换或偷偷重试', async mode => {
    const f = fixture(draft())
    await start(f)
    f.session.edit(text('原请求'))
    f.session.submit('save')
    await flush()
    const original = f.transport.writes[0].command
    const result = success(original)
    if (mode === 'network') f.transport.writes[0].result.reject(new Error('断开'))
    else if (mode === 'authorization') f.transport.writes[0].result.resolve({ status: 'error', message: '需要登录', signInRequired: true })
    else if (mode === 'unknown') {
      // @ts-expect-error 外部协议必须接受运行时校验，不能依赖静态类型。
      f.transport.writes[0].result.resolve({ status: 'future-protocol-status' })
    } else {
      if (mode === 'wrong-document') result.value.draft.id = crypto.randomUUID()
      if (mode === 'wrong-content') result.value.draft.body = '不是请求中的内容'
      if (mode === 'wrong-publication') result.value.publication = { id: 1, publishedAt: date }
      f.transport.writes[0].result.resolve(result)
    }
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ pending: original, serverStatus: 'unconfirmed', manualBusy: false, signInRequired: mode === 'authorization' })
    f.session.edit(text('更晚文本', ''))
    f.session.submit('publish')
    expect(f.session.getSnapshot()).toMatchObject({ pending: original, feedback: { status: 'error', message: expect.stringContaining('原操作') } })
    const latest = f.store.puts.at(-1)
    expect(latest).toMatchObject({ pending: original, content: text('更晚文本', '') })
    await pauseWithoutWrites(f, 1)
  })

  it('online、重登或 checkServer 只 inspect，未收到回执时保持 pending，绝不代执行', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('原请求'))
    f.session.submit('publish')
    await flush()
    const original = f.transport.writes[0].command
    f.transport.writes[0].result.resolve({ status: 'error', message: '需要登录', signInRequired: true })
    await flush()
    expect(f.session.getSnapshot().signInRequired).toBe(true)
    f.session.edit(blank())
    for (let index = 0; index < 2; index++) {
      const checking = f.session.checkServer()
      await flush()
      expect(f.transport.inspections[index].operation).toEqual({ postId: original.postId, operationId: original.operationId })
      f.transport.inspections[index].result.resolve({ status: 'unconfirmed' })
      await checking
      expect(f.session.getSnapshot()).toMatchObject({ pending: original, serverStatus: 'unconfirmed', feedback: { status: 'unconfirmed' }, content: blank() })
      await pauseWithoutWrites(f, 1)
    }
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    expect(f.store.puts.at(-1)?.pending).toEqual(original)
  })

  it.each(['save', 'publish'] as const)('%s 回执确认已提交只更新基线和本机元数据，随后 read 检测另一标签的新修订', async intent => {
    const f = fixture(draft())
    await start(f)
    f.session.edit(text('原请求'))
    f.session.submit(intent)
    await flush()
    const original = f.transport.writes[0].command
    f.transport.writes[0].result.reject(new Error('响应丢失'))
    await flush()
    f.session.edit(text('更晚本机输入'))
    const checking = f.session.checkServer()
    await flush()
    f.transport.inspections[0].result.resolve(success(original, 2))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ pending: null, remote: { revisionId: 2 }, content: text('更晚本机输入'), lastConfirmed: { intent, content: original.content, operationId: original.operationId, via: 'receipt' } })
    expect(Object.isFrozen(f.session.getSnapshot().remote)).toBe(true)
    expect(f.transport.reads).toHaveLength(2)
    const current = draft(original.postId, 3, text('其他标签'))
    f.transport.answerRead(1, current)
    await checking
    expect(f.session.getSnapshot()).toMatchObject({ remote: { revisionId: 2 }, conflict: { current }, serverStatus: 'conflict', content: text('更晚本机输入') })
    expect(f.store.puts.at(-1)).toMatchObject({ pending: null, remote: { revisionId: 2 } })
    await pauseWithoutWrites(f, 1)
  })

  it.each(['reject', 'authorization', 'invalid', 'wrong-document', 'wrong-content', 'wrong-publication', 'unknown'] as const)('inspect %s 不改变原基线与 pending，也不 write', async mode => {
    const baseline = draft()
    const f = fixture(baseline)
    await start(f)
    const original = await makeUnknown(f)
    const checking = f.session.checkServer()
    await flush()
    const inspect = f.transport.inspections[0].result
    if (mode === 'reject') inspect.reject(new Error('无法读取回执'))
    else if (mode === 'authorization') inspect.resolve({ status: 'error', message: '请登录', signInRequired: true })
    else if (mode === 'invalid') inspect.resolve({ status: 'invalid', message: '无法查询' })
    else if (mode === 'unknown') {
      // @ts-expect-error 未知回执协议不能被当作未提交或成功。
      inspect.resolve({ status: 'future-receipt' })
    } else {
      const result = success(original)
      if (mode === 'wrong-document') result.value.draft.id = crypto.randomUUID()
      if (mode === 'wrong-content') result.value.draft.body = '错误内容'
      if (mode === 'wrong-publication') result.value.publication = { id: 1, publishedAt: date }
      inspect.resolve(result)
    }
    await checking
    expect(f.session.getSnapshot()).toMatchObject({ remote: baseline, pending: original, lastConfirmed: null, serverStatus: 'unconfirmed' })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    await pauseWithoutWrites(f, 1)
  })

  it('只有 retryPending 明确重放原请求，成功后必须 read，不上传后续输入', async () => {
    const f = fixture()
    await start(f)
    const original = await makeUnknown(f)
    f.session.edit(text('更晚内容'))
    const retrying = f.session.retryPending()
    f.session.submit('publish')
    await flush()
    expect(f.transport.writes).toHaveLength(2)
    expect(f.transport.writes[1].command).toEqual(original)
    f.transport.answerWrite(1, 2)
    await flush()
    expect(f.transport.reads).toHaveLength(2)
    expect(f.transport.events).toEqual(['read', 'save', 'save', 'read'])
    f.transport.answerRead(1, draft(original.postId, 2, original.content))
    await retrying
    expect(f.session.getSnapshot()).toMatchObject({ pending: null, content: text('更晚内容'), serverStatus: 'unsaved', lastConfirmed: { operationId: original.operationId, via: 'write' } })
    await pauseWithoutWrites(f, 2)
    await f.session.retryPending()
    expect(f.transport.writes).toHaveLength(2)
  })

  it('显式重试得到旧 ACK 后 read 发现新修订，保留两边并 conflict', async () => {
    const f = fixture()
    await start(f)
    const original = await makeUnknown(f)
    f.session.edit(text('本机后来'))
    const retrying = f.session.retryPending()
    await flush()
    f.transport.answerWrite(1, 2)
    await flush()
    const current = draft(original.postId, 3, text('服务器后来'))
    f.transport.answerRead(1, current)
    await retrying
    expect(f.session.getSnapshot()).toMatchObject({ content: text('本机后来'), remote: { revisionId: 2 }, conflict: { current }, serverStatus: 'conflict' })
    await pauseWithoutWrites(f, 2)
  })

  it('无 pending 的重连只 read，远端失败不改基线，retryLocal 不重试网络', async () => {
    const initial = draft()
    const f = fixture(initial)
    await start(f)
    f.session.edit(text('离线输入'))
    const checking = f.session.checkServer()
    await flush()
    f.transport.reads[1].result.reject(new Error('仍然离线'))
    await checking
    expect(f.session.getSnapshot()).toMatchObject({ remote: initial, content: text('离线输入'), serverStatus: 'error' })
    await f.session.retryLocal()
    expect(f.transport.read).toHaveBeenCalledTimes(2)
    expect(f.transport.inspect).not.toHaveBeenCalled()
    await pauseWithoutWrites(f)
  })

  it('同一修订返回不同内容是协议失败，不静默推进编辑基线', async () => {
    const initial = draft()
    const f = fixture(initial)
    await start(f, { ...initial, body: '另一份内容' })
    expect(f.session.getSnapshot()).toMatchObject({ remote: initial, content: text(), serverStatus: 'error' })
    await pauseWithoutWrites(f)
  })

  it('已有稿消失仍保留原基线，不得降格为新稿重建', async () => {
    const initial = draft()
    const f = fixture(initial)
    await start(f, null)
    f.session.edit(text('保留内容'))
    f.session.submit('save')
    await f.session.useServer()
    expect(f.session.getSnapshot()).toMatchObject({ remote: initial, isNew: false, conflict: { current: null }, serverStatus: 'missing', content: text('保留内容') })
    await pauseWithoutWrites(f)
  })
})

describe('恢复与本机分支隔离', () => {
  it('恢复带 pending 的空副本只复制身份、原基线和原请求，启动 inspect 不重放', async () => {
    const baseline = draft()
    const pending = { ...command(baseline), intent: 'publish' as const }
    const copy = recovery({ postId: baseline.id, content: blank(), remote: baseline, pending })
    const f = fixture()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    f.session.edit(text('当前入口输入'))
    const oldSession = f.session.getSnapshot().sessionId
    const restoring = f.session.recover(copy)
    await flush()
    const restored = f.session.getSnapshot()
    expect(restored.sessionId).not.toBe(oldSession)
    expect(restored.sessionId).not.toBe(copy.sessionId)
    expect(restored).toMatchObject({ postId: baseline.id, isNew: false, content: blank(), remote: baseline, pending })
    expect(f.store.copies.get(oldSession)?.content).toEqual(text('当前入口输入'))
    expect(f.store.copies.get(copy.sessionId)).toEqual(copy)
    expect(f.store.copies.get(restored.sessionId)).toMatchObject({ postId: baseline.id, content: blank(), remote: baseline, pending })
    expect(f.transport.inspections[0].operation).toEqual({ postId: baseline.id, operationId: pending.operationId })
    f.transport.inspections[0].result.resolve({ status: 'unconfirmed' })
    await restoring
    expect(f.session.getSnapshot().pending).toEqual(pending)
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    await pauseWithoutWrites(f)
  })

  it('恢复无 pending 的副本只 read，服务器不同修订时保留文本与原基线并冲突', async () => {
    const baseline = draft()
    const copy = recovery({ postId: baseline.id, remote: baseline, content: text('本机分支') })
    const f = fixture()
    await start(f)
    const restoring = f.session.recover(copy)
    await flush()
    expect(f.transport.reads[1].postId).toBe(baseline.id)
    const current = draft(baseline.id, 2, text('服务器分支'))
    f.transport.answerRead(1, current)
    await restoring
    expect(f.session.getSnapshot()).toMatchObject({ content: copy.content, remote: baseline, conflict: { current } })
    await pauseWithoutWrites(f)
  })

  it('useServer 等本机最新输入保留成功才采用远端，独立 session 不删除原分支', async () => {
    const baseline = draft()
    const current = draft(baseline.id, 2, text('服务器分支'))
    const f = fixture(baseline)
    await start(f, current)
    f.session.edit(text('本机分支'))
    await flush()
    const oldSession = f.session.getSnapshot().sessionId
    f.store.hold = true
    const selecting = f.session.useServer()
    await flush()
    f.session.edit(text('保留前继续输入'))
    f.store.holds[0].resolve()
    await flush()
    expect(f.store.holds).toHaveLength(3)
    expect(f.session.getSnapshot().sessionId).toBe(oldSession)
    f.store.hold = false
    f.store.holds[1].resolve()
    f.store.holds[2].resolve()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ content: text('服务器分支'), remote: current, pending: null })
    expect(f.session.getSnapshot().sessionId).not.toBe(oldSession)
    expect(f.store.copies.get(oldSession)?.content).toEqual(text('保留前继续输入'))
    expect(f.store.copies.get(f.session.getSnapshot().sessionId)?.remote).toEqual(current)
    f.transport.answerRead(1, current)
    await selecting
    expect(f.session.getSnapshot().shouldWarn).toBe(false)
    expect(f.store.remove).not.toHaveBeenCalled()
    await pauseWithoutWrites(f)
  })

  it.each(['useServer', 'forkLocal', 'recover'] as const)('%s 保留当前分支失败就不切换，不覆盖或抛弃输入', async action => {
    const initial = draft()
    const f = fixture(initial)
    await start(f, draft(initial.id, 2))
    f.session.edit(text('必须保留'))
    const before = f.session.getSnapshot()
    f.store.putFailure = '空间不足'
    if (action === 'recover') await f.session.recover(recovery())
    else await f.session[action]()
    expect(f.session.getSnapshot()).toMatchObject({ sessionId: before.sessionId, postId: before.postId, content: text('必须保留'), remote: initial, localStatus: 'failed' })
    await pauseWithoutWrites(f)
  })

  it('forkLocal 仅换 UUID 与 session、清空 remote/pending，保留原未知请求，不建服务器文章', async () => {
    const f = fixture(draft())
    await start(f)
    const original = await makeUnknown(f)
    f.session.edit(text('带入新分支'))
    const oldSession = f.session.getSnapshot().sessionId
    await f.session.forkLocal()
    const forked = f.session.getSnapshot()
    expect(forked.sessionId).not.toBe(oldSession)
    expect(forked.postId).not.toBe(original.postId)
    expect(forked).toMatchObject({ remote: null, pending: null, isNew: true, content: text('带入新分支'), lastConfirmed: null })
    expect(f.store.copies.get(oldSession)).toMatchObject({ postId: original.postId, pending: original, content: text('带入新分支') })
    expect(f.store.copies.get(forked.sessionId)).toMatchObject({ postId: forked.postId, remote: null, pending: null })
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    expect(f.transport.inspect).not.toHaveBeenCalled()
    await pauseWithoutWrites(f, 1)
  })

  it('显式跳过与删除副本均不上传，删完候选仍独立要求选择，失败不删除或清空', async () => {
    const f = fixture()
    const copy = recovery()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    f.session.edit(text('当前分支'))
    await f.session.discardRecovery(crypto.randomUUID())
    await f.session.discardRecovery(f.session.getSnapshot().sessionId)
    expect(f.store.remove).not.toHaveBeenCalled()
    f.store.remove.mockRejectedValueOnce(new Error('删除失败'))
    await f.session.discardRecovery(copy.sessionId)
    f.session.edit(text('新的当前输入'))
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [copy], localStatus: 'failed', localError: '删除失败', recoveryRequired: true })
    await f.session.discardRecovery(copy.sessionId)
    expect(f.session.getSnapshot()).toMatchObject({ candidates: [], recoveryRequired: true, localError: null })
    await pauseWithoutWrites(f)
    await f.session.skipRecovery()
    expect(f.session.getSnapshot()).toMatchObject({ recoveryRequired: false, content: text('新的当前输入') })
    await pauseWithoutWrites(f)
  })

  it('pending 落本机期间出现损坏副本时撤销未发出的写授权，跳过恢复也不自动补发', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    await flush()
    f.store.hold = true
    f.session.submit('save')
    await flush()
    const pending = f.session.getSnapshot().pending
    await f.session.recover(Object.assign(recovery(), { format: 'nim-recovery/v1' }))
    f.store.holds[0].resolve()
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ recoveryRequired: true, pending, manualBusy: false })
    await f.session.skipRecovery()
    await pauseWithoutWrites(f)
    expect(f.session.getSnapshot().pending).toEqual(pending)
  })

  it('新稿清空文本后恢复原发布请求，只读回执可确认，不创建或重放服务器文章', async () => {
    const pending = { ...command(null), intent: 'publish' as const }
    const copy = recovery({ postId: pending.postId, content: blank(), pending })
    const f = fixture()
    f.store.copies.set(copy.sessionId, copy)
    await start(f)
    expect(f.session.getSnapshot().candidates).toEqual([copy])
    const restoring = f.session.recover(copy)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ remote: null, isNew: true, content: blank(), pending })
    f.transport.inspections[0].result.resolve(success(pending, 1))
    await flush()
    f.transport.answerRead(1, draft(pending.postId, 1, pending.content))
    await restoring
    expect(f.session.getSnapshot()).toMatchObject({
      isNew: false, pending: null, content: blank(), remote: { revisionId: 1 },
      lastConfirmed: { intent: 'publish', operationId: pending.operationId, via: 'receipt' },
    })
    const networks = [f.transport.read.mock.calls.length, f.transport.inspect.mock.calls.length]
    await f.session.retryLocal()
    expect([f.transport.read.mock.calls.length, f.transport.inspect.mock.calls.length]).toEqual(networks)
    expect(f.store.copies.get(copy.sessionId)).toEqual(copy)
    await pauseWithoutWrites(f)
  })

  it('损坏恢复输入保留当前分支及原记录，不接受旧格式或额外字段', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('当前输入'))
    const before = f.session.getSnapshot()
    const copy = recovery()
    await f.session.recover(Object.assign(copy, { isNew: true }))
    expect(f.session.getSnapshot()).toMatchObject({ sessionId: before.sessionId, content: text('当前输入'), localStatus: 'failed', recoveryRequired: true })
    expect(f.store.remove).not.toHaveBeenCalled()
    await pauseWithoutWrites(f)
  })
})

describe('epoch、串行网络与框架控制流', () => {
  it('fork 的旧 ACK 不进入新 epoch，新的明确保存也必须等旧网络完成后发送', async () => {
    const initial = draft()
    const f = fixture(initial)
    await start(f)
    f.session.edit(text('在途写'))
    f.session.submit('save')
    await flush()
    const original = f.transport.writes[0].command
    const oldSession = f.session.getSnapshot().sessionId
    await f.session.forkLocal()
    const forked = f.session.getSnapshot()
    f.session.submit('publish')
    await flush()
    expect(f.transport.writes).toHaveLength(1)
    f.transport.answerWrite(0)
    await flush()
    expect(f.session.getSnapshot()).toMatchObject({ postId: forked.postId, remote: null, lastConfirmed: null })
    expect(f.transport.writes[1].command).toMatchObject({ postId: forked.postId, expectedRevisionId: null, intent: 'publish' })
    expect(f.store.copies.get(oldSession)?.pending).toEqual(original)
    f.transport.answerWrite(1, 3)
    await flush()
    expect(f.session.getSnapshot().remote?.id).toBe(forked.postId)
    await pauseWithoutWrites(f, 2)
  })

  it('旧 epoch 的 inspect 与 read 结果不会覆盖新分支或调度新请求', async () => {
    const f = fixture()
    await start(f)
    const original = await makeUnknown(f)
    const checking = f.session.checkServer()
    await flush()
    await f.session.forkLocal()
    const forked = f.session.getSnapshot()
    f.transport.inspections[0].result.resolve(success(original))
    await checking
    expect(f.session.getSnapshot()).toBe(forked)
    expect(f.transport.read).toHaveBeenCalledTimes(1)
    await pauseWithoutWrites(f, 1)

    const g = fixture(draft())
    const starting = g.session.start()
    await flush()
    await g.session.forkLocal()
    const next = g.session.getSnapshot()
    g.transport.answerRead(0, draft(g.transport.reads[0].postId, 3))
    await starting
    expect(g.session.getSnapshot()).toBe(next)
    await pauseWithoutWrites(g)
  })

  it('分支保留失败不取消尚未发送的明确请求，也不另开写队列', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    f.session.edit(text())
    f.session.submit('save')
    await flush()
    expect(f.store.holds).toHaveLength(2)
    const postId = f.session.getSnapshot().postId
    const forking = f.session.forkLocal()
    await flush()
    f.store.holds[0].resolve()
    f.store.holds[2].reject(new Error('保留失败'))
    await forking
    f.store.holds[1].resolve()
    await flush()
    expect(f.session.getSnapshot().postId).toBe(postId)
    expect(f.transport.writes).toHaveLength(1)
    expect(f.transport.writes[0].command.postId).toBe(postId)
  })

  it('read 收尾订阅者重入 useServer，新分支的检查仍进入同一队列', async () => {
    const initial = draft()
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
    const current = draft(initial.id, 2, text('新远端'))
    f.transport.answerRead(0, current)
    await flush()
    expect(f.transport.reads).toHaveLength(2)
    f.transport.answerRead(1, current)
    await starting
    await selecting
    expect(f.session.getSnapshot()).toMatchObject({ content: text('新远端'), remote: current, serverStatus: 'saved' })
    await pauseWithoutWrites(f)
  })

  it('read 控制流交给 UI 并暂停，不变普通 error，之后 checkServer 仍只读', async () => {
    const signal = { redirect: '/login' }
    const hook = vi.fn((error: unknown) => error === signal)
    const f = fixture(null, new MemoryRecovery(), new ControlledTransport(), hook)
    const starting = f.session.start()
    await flush()
    f.transport.reads[0].result.reject(signal)
    await starting
    expect(hook).toHaveBeenCalledExactlyOnceWith(signal)
    expect(f.session.getSnapshot()).toMatchObject({ serverStatus: 'interrupted', feedback: null, pending: null })
    f.session.edit(text())
    await pauseWithoutWrites(f)
    const checking = f.session.checkServer()
    await flush()
    f.transport.answerRead(1, null)
    await checking
    expect(f.session.getSnapshot().serverStatus).toBe('unsaved')
    await pauseWithoutWrites(f)
  })

  it.each(['write', 'inspect'] as const)('%s 控制流保留固定 pending，checkServer 不重放，也不产生未处理拒绝', async source => {
    const signal = { navigation: 'refresh' }
    const hook = vi.fn((error: unknown) => error === signal)
    const f = fixture(null, new MemoryRecovery(), new ControlledTransport(), hook)
    await start(f)
    f.session.edit(text())
    f.session.submit('save')
    await flush()
    const original = f.transport.writes[0].command
    if (source === 'write') f.transport.writes[0].result.reject(signal)
    else {
      f.transport.writes[0].result.reject(new Error('响应丢失'))
      await flush()
      const checking = f.session.checkServer()
      await flush()
      f.transport.inspections[0].result.reject(signal)
      await checking
    }
    await flush()
    expect(hook).toHaveBeenCalledWith(signal)
    expect(f.session.getSnapshot()).toMatchObject({ serverStatus: 'interrupted', pending: original, shouldWarn: true })
    const checking = f.session.checkServer()
    await flush()
    f.transport.inspections.at(-1)?.result.resolve({ status: 'unconfirmed' })
    await checking
    expect(f.session.getSnapshot()).toMatchObject({ pending: original, serverStatus: 'unconfirmed' })
    await pauseWithoutWrites(f, 1)
  })

  it('普通网络错误不交接控制流，dispose 后晚到 signal 不再调用 UI 钩子', async () => {
    const hook = vi.fn(() => false)
    const f = fixture(null, new MemoryRecovery(), new ControlledTransport(), hook)
    const starting = f.session.start()
    await flush()
    const error = new Error('普通网络错误')
    f.transport.reads[0].result.reject(error)
    await starting
    expect(hook).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.session.getSnapshot().feedback).toMatchObject({ status: 'error', message: error.message })
    const checking = f.session.checkServer()
    await flush()
    f.session.dispose()
    const snapshot = f.session.getSnapshot()
    f.transport.reads[1].result.reject({ redirect: '/late' })
    await checking
    expect(hook).toHaveBeenCalledTimes(1)
    expect(f.session.getSnapshot()).toBe(snapshot)
    await pauseWithoutWrites(f)
  })
})

describe('dispose 与已接受的操作', () => {
  it('dispose 关闭自己的 store，已接受本机 put 继续，但不再通知或启动任何网络', async () => {
    const f = fixture()
    await start(f)
    f.store.hold = true
    const listener = vi.fn()
    f.session.subscribe(listener)
    f.session.edit(text())
    const count = listener.mock.calls.length
    f.session.dispose()
    f.session.dispose()
    const snapshot = f.session.getSnapshot()
    f.store.holds[0].resolve()
    await flush()
    expect(f.store.copies.get(snapshot.sessionId)?.content).toEqual(text())
    expect(f.store.close).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(count)
    expect(snapshot.serverStatus).toBe('disposed')
    f.session.edit(text('忽略'))
    f.session.submit('save')
    await f.session.start()
    await f.session.checkServer()
    await f.session.retryPending()
    await f.session.retryLocal()
    await f.session.forkLocal()
    await pauseWithoutWrites(f)
    expect(f.session.getSnapshot()).toBe(snapshot)
  })

  it('dispose 不伪取消在途服务器写，晚到 ACK 不落本机、不通知、不发后续请求', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text('在途内容'))
    f.session.submit('save')
    await flush()
    f.session.edit(text('更晚内容'))
    const listener = vi.fn()
    f.session.subscribe(listener)
    f.session.dispose()
    const snapshot = f.session.getSnapshot()
    const puts = f.store.puts.length
    f.transport.answerWrite(0)
    await pauseWithoutWrites(f, 1)
    expect(f.store.puts).toHaveLength(puts)
    expect(listener).not.toHaveBeenCalled()
    expect(f.session.getSnapshot()).toBe(snapshot)
    expect(snapshot.pending?.content).toEqual(text('在途内容'))
  })

  it('pending 本机落盘期间 dispose 不再发服务器请求，已接受 put 仍完成', async () => {
    const f = fixture()
    await start(f)
    f.session.edit(text())
    await flush()
    f.store.hold = true
    f.session.submit('publish')
    await flush()
    const pending = f.session.getSnapshot().pending
    f.session.dispose()
    f.store.holds[0].resolve()
    await pauseWithoutWrites(f)
    expect(f.store.copies.get(f.session.getSnapshot().sessionId)?.pending).toEqual(pending)
  })
})
