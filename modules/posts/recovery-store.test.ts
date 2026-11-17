// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryStore } from './recovery-store'
import { recoveryCopySchema, type RecoveryCopy } from './writing'

const sessionId = '22222222-2222-4222-8222-222222222222'
const postId = '11111111-1111-4111-8111-111111111111'
const time = '2026-11-15T12:00:00.000Z'

function copy(overrides: Partial<RecoveryCopy> = {}): RecoveryCopy {
  return {
    format: 'nim-recovery/v2',
    sessionId,
    postId,
    content: { title: '', description: '', body: '  原始正文\r\n' },
    remote: null,
    pending: null,
    updatedAt: time,
    ...overrides,
  }
}

function remote(id = postId) {
  return {
    id,
    title: '远端标题',
    description: '',
    body: '远端正文',
    revisionId: 1,
    createdAt: time,
    updatedAt: time,
  }
}

function pending(id = postId): NonNullable<RecoveryCopy['pending']> {
  return {
    intent: 'save',
    postId: id,
    operationId: '33333333-3333-4333-8333-333333333333',
    expectedRevisionId: 1,
    content: { title: '明确保存的标题', description: '', body: '待确认的正文' },
  }
}

describe('本机恢复副本的纯 schema 边界', () => {
  it('保留空草稿、原始文本和全部恢复上下文，并产生独立快照', () => {
    const value = copy({ remote: remote(), pending: pending() })
    const parsed = recoveryCopySchema.parse(value)
    expect(parsed).toEqual(value)
    expect(parsed).not.toBe(value)
    expect(parsed.content).not.toBe(value.content)
    expect(parsed.remote).not.toBe(value.remote)
    expect(parsed.pending).not.toBe(value.pending)

    value.content.body = '后来编辑'
    expect(parsed.content.body).toBe('  原始正文\r\n')
  })

  it('新稿与已有稿均要求 UUID 文档身份，服务器草稿是明确保存的修订', () => {
    const existing = copy({ remote: remote(), pending: pending() })
    expect(recoveryCopySchema.parse(existing)).toEqual(existing)
    expect(recoveryCopySchema.safeParse({ ...existing, postId: 'legacy-post' }).success).toBe(false)
    expect(recoveryCopySchema.safeParse(copy({ postId: 'legacy-post' })).success).toBe(false)
    expect(recoveryCopySchema.safeParse(copy({ remote: remote() })).success).toBe(true)
  })

  it.each([
    null,
    [],
    {},
    copy({ sessionId: 'not-a-uuid' }),
    copy({ postId: '' }),
    copy({ updatedAt: 'not-a-time' }),
    copy({ updatedAt: '2026-02-30T12:00:00.000Z' }),
    { ...copy(), format: 'nim-recovery/v1' },
    { ...copy(), format: 'nim-recovery/v3' },
    { ...copy(), isNew: true },
    { ...copy(), content: { title: '', description: '', body: 123 } },
    { ...copy(), remote: { ...remote(), revisionId: 0 } },
    { ...copy(), remote: { ...remote(), version: 'working-1' } },
    { ...copy(), pending: { ...pending(), operationId: 'not-a-uuid' } },
    { ...copy(), pending: { ...pending(), intent: 'autosave' } },
    copy({ remote: remote('another-post') }),
    copy({ pending: pending('another-post') }),
    copy({ remote: remote(), pending: { ...pending(), expectedRevisionId: 2 } }),
    copy({ pending: pending() }),
    copy({ remote: remote(), pending: { ...pending(), expectedRevisionId: null } }),
  ])('拒绝损坏、未来版本或身份不一致的记录 %#', input => {
    expect(recoveryCopySchema.safeParse(input).success).toBe(false)
  })

  it.each([
    { ...copy(), future: 'unknown' },
    { ...copy(), content: { ...copy().content, future: 'unknown' } },
    { ...copy(), remote: { ...remote(), future: 'unknown' } },
    { ...copy({ remote: remote() }), pending: { ...pending(), future: 'unknown' } },
    { ...copy({ remote: remote() }), pending: { ...pending(), content: { ...pending().content, future: 'unknown' } } },
  ])('拒绝未知字段，不以剥离数据伪装成功解析 %#', input => {
    expect(recoveryCopySchema.safeParse(input).success).toBe(false)
  })

  it.each(['save', 'publish'] as const)('pending 只容纳明确的 %s 命令，空文本副本仍可携带原请求', intent => {
    const command = { ...pending(), expectedRevisionId: null, intent }
    const value = copy({ content: { title: '', description: '', body: '' }, pending: command })
    expect(recoveryCopySchema.parse(value)).toEqual(value)
    expect(recoveryCopySchema.safeParse(copy({ pending: {
      ...command, content: { ...command.content, title: '  ' },
    } })).success).toBe(false)
  })
})

// Node/jsdom 没有原生 IndexedDB。这些测试不模拟事务，不作为浏览器存储验收。
describe('恢复适配器的非浏览器边界', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 window 和 IndexedDB 时仍可导入、创建和关闭，不在创建时打开数据库', () => {
    expect(typeof window).toBe('undefined')
    expect(() => {
      const store = createRecoveryStore()
      store.close()
      store.close()
    }).not.toThrow()
  })

  it('存储不可用明确拒绝，失败不污染后续操作队列', async () => {
    const store = createRecoveryStore()
    try {
      await expect(store.list()).rejects.toThrow('当前环境不支持 IndexedDB')
      await expect(store.remove('not-a-uuid')).rejects.toMatchObject({ name: 'ZodError' })
      await expect(store.put(copy())).rejects.toThrow('当前环境不支持 IndexedDB')
      await expect(store.list(postId)).rejects.toThrow('当前环境不支持 IndexedDB')
    } finally {
      store.close()
    }
  })

  it('同步 open 异常原样上抛，新的调用重新连接而不复用失败结果', async () => {
    const firstFailure = new Error('第一次连接失败')
    const secondFailure = new Error('第二次连接失败')
    // 仅注入同步异常，不模拟 IDB 请求、事务或持久化行为。
    const open = vi.fn()
      .mockImplementationOnce(() => { throw firstFailure })
      .mockImplementation(() => { throw secondFailure })
    vi.stubGlobal('indexedDB', { open })
    const store = createRecoveryStore()
    try {
      await expect(store.list()).rejects.toBe(firstFailure)
      await expect(store.list()).rejects.toBe(secondFailure)
      expect(open).toHaveBeenCalledTimes(2)
    } finally {
      store.close()
    }
  })

  it('无效副本在写入前被拒绝，保留明确的 schema 错误原因', async () => {
    const store = createRecoveryStore()
    try {
      await expect(store.put(copy({ remote: remote('another-post') }))).rejects.toMatchObject({
        message: '本机恢复副本损坏或格式不受支持，原有数据已保留。',
        cause: { name: 'ZodError' },
      })
    } finally {
      store.close()
    }
  })

  it('多个实例共享已接受的调用序，close 不重排或丢弃这些操作', async () => {
    const first = createRecoveryStore()
    const second = createRecoveryStore()
    const completed: string[] = []
    const operations = [
      first.list().catch(() => { completed.push('first') }),
      second.remove('not-a-uuid').catch(() => { completed.push('second') }),
      first.put(copy()).catch(() => { completed.push('third') }),
    ]
    first.close()
    second.close()
    await Promise.all(operations)
    expect(completed).toEqual(['first', 'second', 'third'])
  })

  it('close 不丢弃已经排队的操作，之后的新操作全部拒绝', async () => {
    const store = createRecoveryStore()
    const accepted = store.put(copy())
    store.close()
    await expect(accepted).rejects.toThrow('当前环境不支持 IndexedDB')
    await expect(store.list()).rejects.toThrow('本机恢复存储已关闭')
    await expect(store.put(copy())).rejects.toThrow('本机恢复存储已关闭')
    await expect(store.remove(sessionId)).rejects.toThrow('本机恢复存储已关闭')
  })
})
