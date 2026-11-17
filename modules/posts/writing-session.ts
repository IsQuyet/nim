import { draftPostSchema, postFieldsSchema, samePostContent, type DraftPost, type PostContent } from './model'
import {
  draftReadResultSchema,
  receiptFeedbackSchema,
  recoveryCopySchema,
  writingCommandSchema,
  writingFeedbackSchema,
  type ReceiptFeedback,
  type RecoveryCopy,
  type RecoveryStore,
  type WritingAcknowledgement,
  type WritingCommand,
  type WritingFeedback,
  type WritingIntent,
  type WritingTransport,
} from './writing'

export type WritingSessionSnapshot = Readonly<{
  content: Readonly<PostContent>
  postId: string
  sessionId: string
  isNew: boolean
  remote: DraftPost | null
  candidates: readonly RecoveryCopy[]
  recoveryRequired: boolean
  pending: WritingCommand | null
  manualBusy: boolean
  serverStatus: 'idle' | 'checking' | 'unsaved' | 'saving' | 'saved' | 'unconfirmed' | 'error' | 'invalid' | 'conflict' | 'missing' | 'interrupted' | 'disposed'
  localStatus: 'idle' | 'saving' | 'saved' | 'failed'
  localError: string | null
  feedback: WritingFeedback | ReceiptFeedback | null
  signInRequired: boolean
  conflict: Readonly<{ current: DraftPost | null }> | null
  lastConfirmed: Readonly<{ intent: WritingIntent; content: Readonly<PostContent>; operationId: string; via: 'write' | 'receipt' }> | null
  shouldWarn: boolean
}>

export type WritingSessionOptions = {
  postId: string
  initial: DraftPost | null
  transport: WritingTransport
  recovery: RecoveryStore
  // 返回 true 表示 UI 已识别并转交控制流。钩子自身不抛出，也不接管普通网络失败。
  handleControlFlow?: (error: unknown) => boolean
}

const emptyContent = (): PostContent => ({ title: '', description: '', body: '' })
const nonempty = (content: PostContent) => !samePostContent(content, emptyContent())
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

function contentOf(content: PostContent): PostContent {
  return Object.freeze(postFieldsSchema.strict().parse({ title: content.title, description: content.description, body: content.body }))
}

function freezeRemote(draft: DraftPost): DraftPost {
  return Object.freeze(draftPostSchema.parse(draft))
}

function freezeCommand(command: WritingCommand): WritingCommand {
  const parsed = writingCommandSchema.parse(command)
  Object.freeze(parsed.content)
  return Object.freeze(parsed)
}

function freezeCopy(copy: RecoveryCopy): RecoveryCopy {
  const parsed = recoveryCopySchema.parse(copy)
  Object.freeze(parsed.content)
  if (parsed.remote) Object.freeze(parsed.remote)
  if (parsed.pending) {
    Object.freeze(parsed.pending.content)
    Object.freeze(parsed.pending)
  }
  return Object.freeze(parsed)
}

function acknowledgementOf(command: WritingCommand, value: WritingAcknowledgement): WritingAcknowledgement {
  if (value.draft.id !== command.postId) throw new Error('服务器返回了其他文档的确认结果。')
  if (!samePostContent(command.content, value.draft)) throw new Error('服务器的确认内容与原请求不一致，写入结果无法确认。')
  if ((command.intent === 'publish') !== (value.publication !== null)) throw new Error('服务器的发布确认与原请求不一致，写入结果无法确认。')
  return Object.freeze({
    draft: freezeRemote(value.draft),
    publication: value.publication ? Object.freeze(value.publication) : null,
  })
}

/**
 * 文本保护只写本机。服务器写入的唯一入口是 submit 和 retryPending 的明确选择。
 * 网络检查、回执确认和写入共用一条队列，固定请求在结果未知时不会被新输入替换。
 * 每个分支使用独立恢复键。切换前保留最新输入，epoch 隔离旧分支的晚到结果。
 * dispose 关闭所拥有的 recovery 端口，不撤销已接受的本机写入或已发出的服务器请求。
 */
export class WritingSession {
  private readonly transport: WritingTransport
  private readonly recovery: RecoveryStore
  private readonly handleControlFlow: WritingSessionOptions['handleControlFlow']
  private sessionId = crypto.randomUUID()
  private postId: string
  private content: PostContent
  private remote: DraftPost | null
  private candidates: readonly RecoveryCopy[] = Object.freeze([])
  private pending: WritingCommand | null = null
  private manual: WritingCommand | null = null
  private writeRequested = false
  private replayRequested = false
  private conflict: WritingSessionSnapshot['conflict'] = null
  private feedback: WritingSessionSnapshot['feedback'] = null
  private lastConfirmed: WritingSessionSnapshot['lastConfirmed'] = null
  private signInRequired = false
  private serverIssue: 'error' | 'invalid' | 'unconfirmed' | null = null
  private localStatus: WritingSessionSnapshot['localStatus'] = 'idle'
  private putError: string | null = null
  private listError: string | null = null
  private managementError: string | null = null
  private started = false
  private disposed = false
  private interrupted = false
  private recoveryGate = false
  private needsList = false
  private needsCheck = false
  private sending = false
  private checking = false
  private switching = false
  private running: Promise<void> | null = null
  private pumpRequested = false
  private epoch = 0
  private revision = 0
  private putSequence = 0
  private transition = 0
  private listeners = new Set<() => void>()
  private snapshot: WritingSessionSnapshot

  constructor({ postId, initial, transport, recovery, handleControlFlow }: WritingSessionOptions) {
    recoveryCopySchema.shape.postId.parse(postId)
    if (initial && initial.id !== postId) throw new Error('初始草稿与文档身份不一致。')
    this.postId = postId
    this.remote = initial ? freezeRemote(initial) : null
    this.content = contentOf(initial ?? emptyContent())
    this.transport = transport
    this.recovery = recovery
    this.handleControlFlow = handleControlFlow
    this.snapshot = this.buildSnapshot()
  }

  getSnapshot = (): WritingSessionSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  start(): Promise<void> {
    if (this.disposed || this.started) return this.running ?? Promise.resolve()
    this.started = true
    this.needsList = true
    this.needsCheck = true
    this.checking = true
    this.emit()
    return this.pump()
  }

  edit(content: PostContent): void {
    if (this.disposed) return
    const next = contentOf(content)
    if (samePostContent(next, this.content)) return
    this.content = next
    this.revision++
    if (this.serverIssue === 'invalid') {
      this.serverIssue = null
      if (this.feedback?.status === 'invalid') this.feedback = null
    }
    void this.persist()
    this.emit()
  }

  submit(intent: WritingIntent): void {
    if (this.disposed || this.switching || this.snapshot.manualBusy) return
    if (this.pending) {
      this.serverIssue = 'unconfirmed'
      this.feedback = Object.freeze({ status: 'error', message: '上次操作的结果尚未确认，请先检查服务器回执，或明确重试原操作。' })
      this.emit()
      return
    }
    if (this.recoveryGate) {
      this.feedback = Object.freeze({ status: 'error', message: '请先处理本机恢复副本，再保存或发布。' })
      this.emit()
      return
    }
    if (this.conflict) return
    const parsed = writingCommandSchema.safeParse({
      postId: this.postId,
      operationId: crypto.randomUUID(),
      expectedRevisionId: this.remote?.revisionId ?? null,
      intent,
      content: this.content,
    })
    if (!parsed.success) {
      this.serverIssue = 'invalid'
      this.feedback = Object.freeze({ status: 'invalid', message: parsed.error.issues[0]?.message ?? '稿件内容无效。' })
      this.emit()
      return
    }
    this.manual = freezeCommand(parsed.data)
    this.interrupted = false
    this.serverIssue = null
    this.emit()
    if (!this.started) void this.start()
    else void this.pump()
  }

  checkServer(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.interrupted = false
    if (!this.started) return this.start()
    this.needsCheck = true
    return this.pump()
  }

  retryPending(): Promise<void> {
    if (this.disposed || this.switching || this.snapshot.manualBusy || !this.pending) return Promise.resolve()
    if (this.recoveryGate) {
      this.feedback = Object.freeze({ status: 'error', message: '请先处理本机恢复副本，再重试原操作。' })
      this.emit()
      return Promise.resolve()
    }
    this.interrupted = false
    this.writeRequested = true
    this.replayRequested = true
    this.emit()
    return this.pump()
  }

  async retryLocal(): Promise<void> {
    if (this.disposed) return
    const epoch = this.epoch
    const retryList = this.listError !== null
    // 无论服务器是否已确认，都重新提交本机快照。这里不调度任何网络操作。
    const saving = this.persist()
    if (retryList) await this.listCandidates(epoch)
    await saving
  }

  async recover(copy: RecoveryCopy): Promise<void> {
    if (this.disposed) return
    let selected: RecoveryCopy
    try {
      selected = freezeCopy(copy)
    } catch (error) {
      this.managementError = messageOf(error, '本机恢复副本损坏，原有数据已保留。')
      this.recoveryGate = true
      this.manual = null
      this.writeRequested = false
      this.replayRequested = false
      this.emit()
      return
    }
    await this.changeBranch(() => {
      this.postId = selected.postId
      this.content = contentOf(selected.content)
      this.remote = selected.remote
      this.pending = selected.pending
      this.needsCheck = true
    })
  }

  async useServer(): Promise<void> {
    if (this.disposed || !this.conflict) return
    const current = this.conflict.current
    if (!current) {
      this.feedback = Object.freeze({ status: 'error', message: '远端稿件不存在，请将本机内容另存为新稿。' })
      this.emit()
      return
    }
    await this.changeBranch(() => {
      this.content = contentOf(current)
      this.remote = current
      this.needsCheck = true
    })
  }

  async forkLocal(): Promise<void> {
    if (this.disposed) return
    await this.changeBranch(() => {
      this.postId = crypto.randomUUID()
      this.remote = null
    })
  }

  async skipRecovery(): Promise<void> {
    if (this.disposed) return
    this.candidates = Object.freeze([])
    this.recoveryGate = false
    // 跳过只解除选择闸门，不删除损坏记录、不清除本机错误，也不授权写服务器。
    this.needsList = false
    this.emit()
  }

  async discardRecovery(sessionId: string): Promise<void> {
    if (this.disposed || !this.candidates.some(copy => copy.sessionId === sessionId)) return
    const epoch = this.epoch
    try {
      await this.recovery.remove(sessionId)
      if (this.disposed || this.epoch !== epoch) return
      this.candidates = Object.freeze(this.candidates.filter(copy => copy.sessionId !== sessionId))
      this.managementError = null
    } catch (error) {
      if (this.disposed || this.epoch !== epoch) return
      this.managementError = messageOf(error, '无法删除本机恢复副本，原副本已保留。')
    }
    // 删除不是选择当前分支，最后一个候选删除后仍需显式跳过恢复。
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch++
    this.transition++
    this.listeners.clear()
    this.snapshot = this.buildSnapshot()
    this.recovery.close()
  }

  private dirty(): boolean {
    return this.remote ? !samePostContent(this.content, this.remote) : nonempty(this.content)
  }

  private buildSnapshot(): WritingSessionSnapshot {
    const localError = this.listError ?? this.managementError ?? this.putError
    const localStatus = localError ? 'failed' : this.localStatus
    const manualBusy = this.manual !== null || this.writeRequested || this.sending
    const serverStatus: WritingSessionSnapshot['serverStatus'] = this.disposed ? 'disposed'
      : this.interrupted ? 'interrupted'
        : this.conflict ? (this.conflict.current ? 'conflict' : 'missing')
          : this.sending ? 'saving'
            : this.checking ? 'checking'
              : this.serverIssue ?? (this.pending ? 'unconfirmed' : this.dirty() ? 'unsaved' : this.remote ? 'saved' : 'idle')
    return Object.freeze({
      content: this.content, postId: this.postId, sessionId: this.sessionId, isNew: this.remote === null,
      remote: this.remote, candidates: this.candidates, recoveryRequired: this.recoveryGate,
      pending: this.pending, manualBusy, serverStatus, localStatus, localError,
      feedback: this.feedback, signInRequired: this.signInRequired, conflict: this.conflict, lastConfirmed: this.lastConfirmed,
      shouldWarn: localStatus === 'saving' || localStatus === 'failed' || this.pending !== null || manualBusy || this.dirty(),
    })
  }

  private emit(): void {
    if (this.disposed) return
    const next = this.buildSnapshot()
    if (Object.entries(next).every(([key, value]) => Reflect.get(this.snapshot, key) === value)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }

  private currentCopy(): RecoveryCopy {
    return freezeCopy({
      format: 'nim-recovery/v2', sessionId: this.sessionId, postId: this.postId,
      content: this.content, remote: this.remote, pending: this.pending, updatedAt: new Date().toISOString(),
    })
  }

  private async persist(): Promise<boolean> {
    const epoch = this.epoch
    const revision = this.revision
    const sequence = ++this.putSequence
    this.localStatus = 'saving'
    this.emit()
    try {
      // 调用时交出独立不可变副本，后续输入和 dispose 都不撤销已接受的本机写入。
      await this.recovery.put(this.currentCopy())
      if (!this.disposed && this.epoch === epoch && this.revision === revision && this.putSequence === sequence) {
        this.putError = null
        this.localStatus = 'saved'
        this.emit()
      }
      return true
    } catch (error) {
      if (!this.disposed && this.epoch === epoch && this.revision === revision && this.putSequence === sequence) {
        this.putError = messageOf(error, '无法保存本机恢复副本。')
        this.localStatus = 'failed'
        this.emit()
      }
      return false
    }
  }

  private async listCandidates(epoch: number): Promise<void> {
    const postId = this.postId
    const isNew = this.remote === null
    try {
      const copies = (await this.recovery.list(isNew ? undefined : postId)).map(freezeCopy)
      if (this.disposed || this.epoch !== epoch) return
      this.candidates = Object.freeze(copies.filter(copy => copy.sessionId !== this.sessionId && (isNew
        ? copy.remote === null && (nonempty(copy.content) || copy.pending !== null)
        : copy.postId === postId && (copy.pending !== null || copy.remote === null || !samePostContent(copy.content, copy.remote)))))
      this.listError = null
      this.recoveryGate = this.candidates.length > 0
    } catch (error) {
      if (this.disposed || this.epoch !== epoch) return
      this.listError = messageOf(error, '无法读取本机恢复副本，原有数据已保留。')
      this.recoveryGate = true
    }
    if (this.recoveryGate && (this.manual || this.writeRequested)) {
      this.manual = null
      this.writeRequested = false
      this.replayRequested = false
      this.feedback = Object.freeze({ status: 'error', message: '请先处理本机恢复副本，再保存或发布。' })
    }
    this.emit()
  }

  private async changeBranch(apply: () => void): Promise<void> {
    const transition = ++this.transition
    const epoch = this.epoch
    this.switching = true
    // 输入和服务器确认在等待期间都可能更新。只有最新完整分支已落本机，才能切换。
    while (true) {
      const revision = this.revision
      const saved = await this.persist()
      if (this.disposed || this.transition !== transition || this.epoch !== epoch) return
      if (!saved) {
        this.switching = false
        void this.pump()
        return
      }
      if (revision === this.revision) break
    }
    this.epoch++
    this.sessionId = crypto.randomUUID()
    this.pending = null
    this.manual = null
    this.writeRequested = false
    this.replayRequested = false
    this.conflict = null
    this.feedback = null
    this.lastConfirmed = null
    this.signInRequired = false
    this.serverIssue = null
    this.interrupted = false
    this.candidates = Object.freeze([])
    this.recoveryGate = false
    this.needsList = false
    this.needsCheck = false
    this.listError = null
    this.managementError = null
    this.putError = null
    this.localStatus = 'idle'
    this.sending = false
    this.checking = false
    this.started = true
    apply()
    this.revision++
    this.switching = false
    await this.persist()
    this.emit()
    if (this.needsCheck && !this.disposed) await this.pump()
  }

  private pump(): Promise<void> {
    if (this.disposed || !this.started) return Promise.resolve()
    this.pumpRequested = true
    if (this.running) return this.running
    // 先安装 running 再执行。订阅者在收尾阶段重入时，也由同一网络队列接住。
    const running: Promise<void> = Promise.resolve().then(async () => {
      do {
        this.pumpRequested = false
        await this.drain()
      } while (this.pumpRequested && !this.disposed)
    }).then(() => {
      if (this.running === running) this.running = null
      if (this.pumpRequested && !this.disposed) return this.pump()
    })
    this.running = running
    return running
  }

  private async drain(): Promise<void> {
    while (!this.disposed && !this.switching && !this.interrupted) {
      const epoch = this.epoch
      if (this.needsList) {
        this.needsList = false
        await this.listCandidates(epoch)
        continue
      }
      if (this.writeRequested && this.pending && !this.recoveryGate && !this.conflict) {
        await this.sendPending(epoch)
        continue
      }
      if (this.needsCheck) {
        this.needsCheck = false
        if (this.pending) await this.inspectPending(epoch)
        else await this.readRemote(epoch)
        continue
      }
      if (this.manual) {
        const command = this.manual
        this.manual = null
        if (this.recoveryGate || this.conflict) {
          this.emit()
          return
        }
        this.pending = command
        this.writeRequested = true
        this.replayRequested = false
        this.revision++
        this.emit()
        continue
      }
      if (!this.pending) this.writeRequested = false
      return
    }
  }

  private async sendPending(epoch: number): Promise<void> {
    const command = this.pending
    if (!command) return
    const replay = this.replayRequested
    this.writeRequested = false
    this.replayRequested = false
    this.sending = true
    this.emit()
    await this.persist()
    if (this.disposed || this.epoch !== epoch) return
    if (this.switching) {
      this.sending = false
      this.writeRequested = true
      this.replayRequested = replay
      this.emit()
      return
    }
    if (this.recoveryGate || this.conflict) {
      this.sending = false
      this.writeRequested = false
      this.replayRequested = false
      this.feedback = Object.freeze({ status: 'error', message: '本机分支仍需处理，原请求已保留，请处理后明确重试原操作。' })
      this.emit()
      return
    }
    let result: WritingFeedback
    try {
      result = writingFeedbackSchema.parse(await this.transport.write(command))
      if (result.status === 'success') {
        result = Object.freeze({ status: 'success', value: acknowledgementOf(command, result.value) })
      } else if (result.status === 'conflict') {
        if (result.current && result.current.id !== command.postId) throw new Error('服务器返回了其他文档的冲突结果。')
        result = Object.freeze({ status: 'conflict', current: result.current ? freezeRemote(result.current) : null })
      } else result = Object.freeze({ ...result })
    } catch (error) {
      if (this.deliverControlFlow(error, epoch)) return
      result = Object.freeze({ status: 'error', message: messageOf(error, '网络请求失败，写入结果无法确认。') })
    }
    if (this.disposed || this.epoch !== epoch) return
    this.sending = false
    this.feedback = result
    this.signInRequired = result.status === 'error' && result.signInRequired === true
    if (result.status === 'error') {
      this.serverIssue = 'unconfirmed'
    } else if (result.status === 'success') {
      this.confirm(command, result.value, 'write')
      if (replay) this.needsCheck = true
    } else {
      this.pending = null
      this.revision++
      if (result.status === 'conflict') {
        this.serverIssue = null
        this.conflict = Object.freeze({ current: result.current })
      } else this.serverIssue = 'invalid'
      void this.persist()
    }
    this.emit()
  }

  private confirm(command: WritingCommand, value: WritingAcknowledgement, via: 'write' | 'receipt'): void {
    this.remote = value.draft
    this.pending = null
    this.writeRequested = false
    this.replayRequested = false
    this.serverIssue = null
    this.conflict = null
    this.signInRequired = false
    this.lastConfirmed = Object.freeze({ intent: command.intent, content: command.content, operationId: command.operationId, via })
    this.revision++
    void this.persist()
  }

  private async inspectPending(epoch: number): Promise<void> {
    const command = this.pending
    if (!command) return
    this.checking = true
    this.emit()
    let result: ReceiptFeedback
    try {
      result = receiptFeedbackSchema.parse(await this.transport.inspect({ postId: command.postId, operationId: command.operationId }))
      if (result.status === 'success') result = Object.freeze({ status: 'success', value: acknowledgementOf(command, result.value) })
      else result = Object.freeze({ ...result })
    } catch (error) {
      if (this.deliverControlFlow(error, epoch)) return
      result = Object.freeze({ status: 'error', message: messageOf(error, '无法读取服务器回执，原操作仍待确认。') })
    }
    if (this.disposed || this.epoch !== epoch) return
    this.checking = false
    this.feedback = result
    this.signInRequired = result.status === 'error' && result.signInRequired === true
    if (result.status === 'success') {
      this.confirm(command, result.value, 'receipt')
      // 回执只证明原命令发生过，不证明目前服务器仍停留在该版本。
      this.needsCheck = true
    } else this.serverIssue = 'unconfirmed'
    this.emit()
  }

  private deliverControlFlow(error: unknown, epoch: number): boolean {
    if (this.disposed || this.epoch !== epoch) return true
    if (!this.handleControlFlow?.(error)) return false
    this.interrupted = true
    this.sending = false
    this.checking = false
    this.manual = null
    this.writeRequested = false
    this.replayRequested = false
    this.emit()
    return true
  }

  private async readRemote(epoch: number): Promise<void> {
    const postId = this.postId
    this.checking = true
    this.emit()
    try {
      const result = draftReadResultSchema.parse(await this.transport.read(postId))
      if (this.disposed || this.epoch !== epoch) return
      if (result.status === 'error') {
        this.feedback = Object.freeze({ ...result })
        this.signInRequired = result.signInRequired === true
        this.serverIssue = 'error'
        this.manual = null
      } else {
        const current = result.value ? freezeRemote(result.value) : null
        if (current && current.id !== postId) throw new Error('服务器返回了其他文档。')
        this.signInRequired = false
        if (this.serverIssue !== 'invalid') this.serverIssue = null
        if ((!current && this.remote) || (current && (!this.remote || current.revisionId !== this.remote.revisionId))) {
          this.conflict = Object.freeze({ current })
          this.feedback = Object.freeze({ status: 'conflict', current })
          this.manual = null
        } else if (current && this.remote && !samePostContent(current, this.remote)) {
          throw new Error('同一服务器修订返回了不同内容，原编辑基线已保留。')
        } else {
          this.conflict = null
          if (this.feedback?.status !== 'success' && this.feedback?.status !== 'invalid') this.feedback = null
        }
      }
    } catch (error) {
      if (this.deliverControlFlow(error, epoch)) return
      this.feedback = Object.freeze({ status: 'error', message: messageOf(error, '无法检查服务器草稿。') })
      this.serverIssue = 'error'
      this.manual = null
    }
    if (this.disposed || this.epoch !== epoch) return
    this.checking = false
    this.emit()
  }
}
