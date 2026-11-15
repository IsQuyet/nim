import { postFieldsSchema, samePostContent, type PostContent } from './content'
import {
  recoveryCopySchema,
  workingCopySchema,
  workingCopyReadResultSchema,
  writingFeedbackSchema,
  writingCommandSchema,
  type RecoveryCopy,
  type RecoveryStore,
  type WorkingCopy,
  type WritingCommand,
  type WritingFeedback,
  type WritingTransport,
} from './writing'

export type WritingSessionSnapshot = Readonly<{
  sessionId: string
  postId: string
  isNew: boolean
  content: Readonly<PostContent>
  remote: WorkingCopy | null
  candidates: readonly RecoveryCopy[]
  recoveryRequired: boolean
  pending: WritingCommand | null
  manualBusy: boolean
  syncStatus: 'idle' | 'checking' | 'recovery' | 'dirty' | 'syncing' | 'synced' | 'error' | 'invalid' | 'conflict' | 'missing' | 'interrupted' | 'disposed'
  localStatus: 'idle' | 'saving' | 'saved' | 'failed'
  localError: string | null
  feedback: WritingFeedback | null
  lastConfirmed: Readonly<{ intent: WritingCommand['intent']; content: Readonly<PostContent>; operationId: string }> | null
  signInRequired: boolean
  conflict: Readonly<{ current: WorkingCopy | null }> | null
  shouldWarn: boolean
}>

export type WritingSessionOptions = {
  postId: string
  isNew: boolean
  initial: WorkingCopy | null
  transport: WritingTransport
  recovery: RecoveryStore
  // 返回 true 表示 UI 已识别并转交控制流。钩子自身不抛出，也不接管普通网络失败。
  handleControlFlow?: (error: unknown) => boolean
}
type Manual = { intent: 'save' | 'publish'; content: PostContent }

const emptyContent = (): PostContent => ({ title: '', description: '', body: '' })
const nonempty = (content: PostContent) => !samePostContent(content, emptyContent())
const messageOf = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

function contentOf(content: PostContent): PostContent {
  return Object.freeze(postFieldsSchema.strict().parse({ title: content.title, description: content.description, body: content.body }))
}

function freezeRemote(copy: WorkingCopy): WorkingCopy {
  return Object.freeze(workingCopySchema.parse(copy))
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

/**
 * 不依赖 UI 或框架的单会话控制器。start 幂等，edit 在 start 前和请求期间也可使用。
 * 所有网络操作共用一条队列，未知结果只能重放原请求。转换分支先确认本机保留成功。
 * dispose 拥有并关闭传入的 recovery 端口，不取消已接受的 put 或已发出的网络请求。
 * 框架控制流由 handleControlFlow 在 UI 边界识别并转交，返回 true 后队列暂停。
 */
export class WritingSession {
  private readonly transport: WritingTransport
  private readonly recovery: RecoveryStore
  private readonly handleControlFlow: ((error: unknown) => boolean) | undefined
  private interrupted = false
  private sessionId = crypto.randomUUID()
  private postId: string
  private isNew: boolean
  private content: PostContent
  private remote: WorkingCopy | null
  private candidates: readonly RecoveryCopy[] = Object.freeze([])
  private pending: WritingCommand | null = null
  private manual: Manual | null = null
  private conflict: Readonly<{ current: WorkingCopy | null }> | null = null
  private feedback: WritingFeedback | null = null
  private lastConfirmed: WritingSessionSnapshot['lastConfirmed'] = null
  private signInRequired = false
  private failure: 'error' | 'invalid' | null = null
  private localStatus: WritingSessionSnapshot['localStatus'] = 'idle'
  private putError: string | null = null
  private listError: string | null = null
  private managementError: string | null = null
  private touched = false
  private started = false
  private disposed = false
  private needsList = false
  private needsRead = false
  private checked = false
  private recoveryGate = false
  private replay = false
  private autoDue = false
  private sending = false
  private reading = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | null = null
  private pumpRequested = false
  private epoch = 0
  private revision = 0
  private putSequence = 0
  private transition = 0
  private switching = false
  private listeners = new Set<() => void>()
  private snapshot: WritingSessionSnapshot

  constructor({ postId, isNew, initial, transport, recovery, handleControlFlow }: WritingSessionOptions) {
    if (initial && initial.id !== postId) throw new Error('初始工作稿与文档身份不一致。')
    this.postId = postId
    this.isNew = isNew
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
    this.needsRead = true
    this.emit()
    return this.pump()
  }

  edit(content: PostContent): void {
    if (this.disposed) return
    const next = contentOf(content)
    if (samePostContent(next, this.content)) return
    this.content = next
    this.touched = true
    this.revision++
    if (this.feedback?.status === 'invalid') this.feedback = null
    if (this.failure === 'invalid') this.failure = null
    this.clearTimer()
    this.autoDue = false
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.disposed) return
      this.autoDue = true
      void this.pump()
    }, 1000)
    void this.persist()
    this.emit()
  }

  submit(intent: 'save' | 'publish'): void {
    if (this.disposed || this.manual || this.snapshot.manualBusy || this.conflict) return
    const parsed = writingCommandSchema.safeParse({
      postId: this.postId, operationId: crypto.randomUUID(), expectedVersion: this.remote?.version ?? null,
      intent, content: this.content,
    })
    if (!parsed.success) {
      this.feedback = Object.freeze({ status: 'invalid', message: parsed.error.issues[0]?.message ?? '稿件内容无效。' })
      this.emit()
      return
    }
    // 仅捕获点击时的内容。排到队首时再绑定前一个成功写入产生的版本。
    this.manual = { intent, content: contentOf(this.content) }
    if (this.failure === 'invalid') this.failure = null
    this.emit()
    void this.pump()
  }

  retry(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const localRetry = this.putError ? this.persist() : Promise.resolve(true)
    if (!this.started) return Promise.all([localRetry, this.start()]).then(() => undefined)
    this.interrupted = false
    this.signInRequired = false
    if (this.listError) this.needsList = true
    this.needsRead = true
    if (this.pending) this.replay = true
    if (this.failure === 'error') {
      this.failure = null
      this.feedback = null
    }
    this.autoDue = true
    this.emit()
    return Promise.all([localRetry, this.pump()]).then(() => undefined)
  }

  async recover(copy: RecoveryCopy): Promise<void> {
    if (this.disposed) return
    let selected: RecoveryCopy
    try {
      selected = freezeCopy(copy)
    } catch (error) {
      this.putError = messageOf(error, '本机恢复副本损坏，原有数据已保留。')
      this.localStatus = 'failed'
      this.emit()
      return
    }
    await this.changeBranch(() => {
      this.postId = selected.postId
      this.isNew = selected.isNew
      this.content = contentOf(selected.content)
      this.remote = selected.remote
      this.pending = selected.pending
      this.replay = selected.pending !== null
      this.touched = true
      this.needsRead = true
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
      // new 入口只有明确 save/publish 成功后才退出恢复列表。
      this.touched = false
      this.needsRead = true
    })
  }

  async forkLocal(): Promise<void> {
    if (this.disposed) return
    await this.changeBranch(() => {
      this.postId = crypto.randomUUID()
      this.isNew = true
      this.remote = null
      this.touched = true
      this.needsRead = true
    })
  }

  async discardRecovery(sessionId: string): Promise<void> {
    if (this.disposed || !this.candidates.some(copy => copy.sessionId === sessionId)) return
    const epoch = this.epoch
    try {
      await this.recovery.remove(sessionId)
      if (this.disposed || this.epoch !== epoch) return
      if (this.candidates.some(copy => copy.sessionId === sessionId)) {
        this.candidates = Object.freeze(this.candidates.filter(copy => copy.sessionId !== sessionId))
      }
      this.managementError = null
    } catch (error) {
      if (this.disposed || this.epoch !== epoch) return
      this.managementError = messageOf(error, '无法删除本机恢复副本，原副本已保留。')
    }
    // 删除不是选择当前分支，最后一个候选被删除后也不自动打开同步闸门。
    this.emit()
  }

  skipRecovery(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.candidates = Object.freeze([])
    this.recoveryGate = false
    // 跳过损坏列表是显式决定，不清除错误提示或删除原数据。
    this.needsList = false
    this.emit()
    return this.pump()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch++
    this.transition++
    this.clearTimer()
    this.listeners.clear()
    this.snapshot = this.buildSnapshot()
    this.recovery.close()
  }

  private dirty(): boolean {
    return this.remote ? !samePostContent(this.content, this.remote) : this.touched
  }

  private buildSnapshot(): WritingSessionSnapshot {
    const localError = this.listError ?? this.managementError ?? this.putError
    const localStatus = localError ? 'failed' : this.localStatus
    const manualBusy = this.manual !== null || (this.pending !== null && this.pending.intent !== 'autosave' && this.failure === null && !this.conflict && !this.interrupted)
    const syncStatus: WritingSessionSnapshot['syncStatus'] = this.disposed ? 'disposed'
      : this.interrupted ? 'interrupted'
      : this.conflict ? (this.conflict.current ? 'conflict' : 'missing')
        : this.sending ? 'syncing'
          : this.reading ? 'checking'
            : this.failure ?? (this.listError && this.recoveryGate ? 'recovery'
              : !this.checked ? 'checking'
                : this.recoveryGate && this.started ? 'recovery'
                  : this.dirty() ? 'dirty' : this.remote ? 'synced' : 'idle')
    return Object.freeze({
      sessionId: this.sessionId, postId: this.postId, isNew: this.isNew,
      content: this.content, remote: this.remote, candidates: this.candidates,
      recoveryRequired: this.started && this.recoveryGate, pending: this.pending,
      manualBusy, syncStatus, localStatus, localError, feedback: this.feedback, lastConfirmed: this.lastConfirmed,
      signInRequired: this.signInRequired,
      conflict: this.conflict,
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

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private currentCopy(): RecoveryCopy {
    return freezeCopy({
      format: 'nim-recovery/v1', sessionId: this.sessionId, postId: this.postId,
      isNew: this.isNew, content: this.content, remote: this.remote, pending: this.pending,
      updatedAt: new Date().toISOString(),
    })
  }

  private async persist(): Promise<boolean> {
    const epoch = this.epoch
    const revision = this.revision
    const sequence = ++this.putSequence
    this.localStatus = 'saving'
    this.emit()
    try {
      // 在调用瞬间交出不可变副本，后续 edit 或 dispose 不撤销已经接受的写入。
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

  private async changeBranch(apply: () => void): Promise<void> {
    const transition = ++this.transition
    const epoch = this.epoch
    this.switching = true
    // 等待期间输入仍可变。必须保留最后一份输入，而不是只保留点击时的旧快照。
    while (this.touched || this.pending || nonempty(this.content)) {
      const revision = this.revision
      if (!await this.persist()) {
        if (this.transition === transition) {
          this.switching = false
          void this.pump()
        }
        return
      }
      if (this.disposed || this.transition !== transition || this.epoch !== epoch) return
      if (revision === this.revision) break
    }
    if (this.disposed || this.transition !== transition || this.epoch !== epoch) return
    this.epoch++
    this.sessionId = crypto.randomUUID()
    this.pending = null
    this.manual = null
    this.replay = false
    this.conflict = null
    this.feedback = null
    this.lastConfirmed = null
    this.signInRequired = false
    this.failure = null
    this.interrupted = false
    this.candidates = Object.freeze([])
    this.recoveryGate = false
    this.needsList = false
    this.listError = null
    this.managementError = null
    this.putError = null
    this.localStatus = 'idle'
    this.sending = false
    this.reading = false
    this.checked = true
    this.autoDue = false
    this.clearTimer()
    apply()
    this.autoDue = this.dirty()
    this.revision++
    this.switching = false
    if (this.touched || this.pending || (this.isNew && nonempty(this.content))) void this.persist()
    this.emit()
    await this.pump()
  }

  private pump(): Promise<void> {
    if (this.disposed || !this.started) return Promise.resolve()
    this.pumpRequested = true
    if (this.running) return this.running
    // 延后一微任务，先安装 running。收尾阶段收到的新调度也必须由同一队列接住。
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
        try {
          const copies = (await this.recovery.list(this.isNew ? undefined : this.postId)).map(freezeCopy)
          if (this.disposed || this.epoch !== epoch) continue
          this.candidates = Object.freeze(copies.filter(copy => copy.sessionId !== this.sessionId && (this.isNew
            ? copy.isNew && (nonempty(copy.content) || copy.pending !== null)
            : copy.postId === this.postId && (copy.pending !== null || (copy.remote ? !samePostContent(copy.content, copy.remote) : nonempty(copy.content))))))
          this.listError = null
          this.recoveryGate = this.candidates.length > 0
        } catch (error) {
          if (this.disposed || this.epoch !== epoch) continue
          this.listError = messageOf(error, '无法读取本机恢复副本，原有数据已保留。')
          this.recoveryGate = true
          this.emit()
          return
        }
        this.emit()
        continue
      }
      if (this.listError && this.recoveryGate) return
      if (this.pending && !this.failure && !this.conflict && !this.recoveryGate) {
        await this.sendPending(epoch)
        continue
      }
      if (this.needsRead && !this.pending) {
        this.needsRead = false
        await this.readRemote(epoch)
        continue
      }
      if (!this.checked || this.recoveryGate || this.failure || this.conflict) return
      const manual = this.manual
      if (manual) {
        this.manual = null
        this.makePending(manual.intent, manual.content)
      } else if (this.autoDue && this.dirty()) {
        this.autoDue = false
        this.makePending('autosave', this.content)
      } else return
    }
  }

  private makePending(intent: WritingCommand['intent'], content: PostContent): void {
    this.pending = freezeCommand({
      postId: this.postId, operationId: crypto.randomUUID(), expectedVersion: this.remote?.version ?? null,
      intent, content,
    })
    this.revision++
    this.emit()
  }

  private async sendPending(epoch: number): Promise<void> {
    const command = this.pending
    if (!command) return
    const replay = this.replay
    this.sending = true
    this.emit()
    await this.persist()
    if (this.disposed || this.epoch !== epoch) return
    if (this.switching) {
      this.sending = false
      this.emit()
      return
    }
    let result: WritingFeedback
    try {
      result = writingFeedbackSchema.parse(await this.transport.write(command))
      if (result.status === 'success') {
        const acknowledgement = result.value
        if (acknowledgement.workingCopy.id !== command.postId) throw new Error('服务器返回了其他文档的写入结果。')
        if (!samePostContent(command.content, acknowledgement.workingCopy)) throw new Error('服务器的确认内容与原请求不一致，写入结果无法确认。')
        if ((command.intent === 'publish') !== (acknowledgement.publication !== null)) throw new Error('服务器的发布确认与原请求不一致，写入结果无法确认。')
        result = Object.freeze({ status: 'success', value: Object.freeze({
          workingCopy: freezeRemote(acknowledgement.workingCopy),
          publication: acknowledgement.publication ? Object.freeze(acknowledgement.publication) : null,
        }) })
      } else if (result.status === 'conflict') {
        if (result.current && result.current.id !== command.postId) throw new Error('服务器返回了其他文档的冲突结果。')
        result = Object.freeze({ status: 'conflict', current: result.current ? freezeRemote(result.current) : null })
      } else result = Object.freeze({ ...result })
    } catch (error) {
      if (this.deliverControlFlow(error, epoch)) return
      result = Object.freeze({ status: 'error', message: messageOf(error, '网络请求失败，写入结果未知，请重试确认。') })
    }
    if (this.disposed || this.epoch !== epoch) return
    this.sending = false
    this.feedback = result
    this.signInRequired = result.status === 'error' && result.signInRequired === true
    if (result.status === 'error') {
      this.failure = 'error'
      this.replay = true
    } else {
      this.pending = null
      this.replay = false
      this.revision++
      if (result.status === 'success') {
        this.remote = result.value.workingCopy
        this.lastConfirmed = Object.freeze({ intent: command.intent, content: command.content, operationId: command.operationId })
        if (command.intent !== 'autosave') this.isNew = false
        // 重放得到的是原请求的 ACK，不证明当前远端仍停留在这个版本。
        if (replay) this.needsRead = true
      } else if (result.status === 'conflict') {
        this.conflict = Object.freeze({ current: result.current })
        this.manual = null
      } else {
        this.failure = 'invalid'
        this.manual = null
      }
      void this.persist()
    }
    this.emit()
  }

  private deliverControlFlow(error: unknown, epoch: number): boolean {
    if (this.disposed || this.epoch !== epoch) return true
    if (!this.handleControlFlow?.(error)) return false
    if (!this.disposed && this.epoch === epoch) {
      this.interrupted = true
      this.sending = false
      this.reading = false
      if (this.pending) this.replay = true
      this.emit()
    }
    return true
  }

  private async readRemote(epoch: number): Promise<void> {
    this.reading = true
    this.emit()
    try {
      const result = workingCopyReadResultSchema.parse(await this.transport.read(this.postId))
      if (this.disposed || this.epoch !== epoch) return
      if (result.status === 'error') {
        this.feedback = Object.freeze({ ...result })
        this.signInRequired = result.signInRequired === true
        this.failure = 'error'
      } else {
        this.signInRequired = false
        const current = result.value ? freezeRemote(result.value) : null
        if (current && current.id !== this.postId) throw new Error('服务器返回了其他文档。')
        if (!current && (!this.isNew || this.remote)) {
          this.conflict = Object.freeze({ current: null })
          this.feedback = Object.freeze({ status: 'error', message: '远端稿件不存在，本机输入已保留，请另存为新稿。' })
        } else if (this.conflict || (current && (this.remote ? current.version !== this.remote.version : this.isNew || this.touched))) {
          this.conflict = Object.freeze({ current })
          this.feedback = Object.freeze({ status: 'conflict', current })
        } else if (current && !this.remote) {
          // 只有没有任何本机输入的已有稿，才可由首次 read 初始化内容。
          this.remote = current
          this.content = contentOf(current)
          this.revision++
        }
        this.checked = true
      }
    } catch (error) {
      if (this.deliverControlFlow(error, epoch)) return
      this.feedback = Object.freeze({ status: 'error', message: messageOf(error, '无法检查远端稿件，请重试。') })
      this.failure = 'error'
    }
    if (this.disposed || this.epoch !== epoch) return
    this.reading = false
    this.emit()
  }
}
