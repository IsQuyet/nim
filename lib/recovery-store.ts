import { recoveryCopySchema, type RecoveryCopy, type RecoveryStore } from './writing'

const databaseName = 'nim-writing-recovery'
const storeName = 'copies'
const postIdIndex = 'postId'

// 同一 realm 内共享数据库调用序，实例重建后也不能让旧实例的排队写覆盖新调用。
let databaseQueue: Promise<void> = Promise.resolve()
let blockedOpen: { request: IDBOpenDBRequest; error: Error } | null = null

// 逐版追加迁移，不删除旧存储或用重新建库代替升级。
const migrations: readonly ((database: IDBDatabase, transaction: IDBTransaction) => void)[] = [
  database => {
    const store = database.createObjectStore(storeName, { keyPath: 'sessionId' })
    store.createIndex(postIdIndex, 'postId')
  },
]

function parseCopy(value: unknown): RecoveryCopy {
  const result = recoveryCopySchema.safeParse(value)
  if (!result.success) {
    throw new Error('本机恢复副本损坏或格式不受支持，原有数据已保留。', { cause: result.error })
  }
  return result.data
}

type TransactionAccess = {
  store: IDBObjectStore
  request<Value>(request: IDBRequest<Value>, accept: (value: Value) => void): void
}

function transact<Value>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (access: TransactionAccess, complete: (value: Value) => void) => void,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    let result: { value: Value } | undefined
    let failure: unknown

    function fail(error: unknown) {
      failure = error
      try {
        transaction.abort()
      } catch {
        reject(error)
      }
    }

    function guard(action: () => void) {
      try {
        action()
      } catch (error) {
        fail(error)
      }
    }

    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('本机恢复存储事务已中止。'))
    transaction.onerror = () => {
      failure ??= transaction.error
    }
    // 请求成功不代表提交成功，所有结果均等到事务完成后才交给调用方。
    transaction.oncomplete = () => {
      if (result) resolve(result.value)
      else reject(new Error('本机恢复存储事务未返回结果。'))
    }

    guard(() => {
      const store = transaction.objectStore(storeName)
      const index = store.index(postIdIndex)
      if (store.keyPath !== 'sessionId' || store.autoIncrement
        || index.keyPath !== 'postId' || index.unique || index.multiEntry) {
        throw new Error('本机恢复数据库结构不受支持，原有数据已保留。')
      }
      work({
        store,
        request(request, accept) {
          request.onerror = () => fail(request.error ?? new Error('本机恢复存储请求失败。'))
          request.onsuccess = () => guard(() => accept(request.result))
        },
      }, value => { result = { value } })
    })
  })
}

/**
 * 按需连接本机恢复数据库。同一 realm 的操作按调用顺序执行，写入时保存调用瞬间的快照。
 * close() 后本实例不再接受操作，已经排队的操作仍会完成，随后释放本实例的连接。
 * 不提供跨 realm 的全局调用序，不同编辑会话应使用各自的 sessionId。
 */
export function createRecoveryStore(): RecoveryStore {
  let connection: IDBDatabase | null = null
  let lastOperation: Promise<void> = Promise.resolve()
  let closed = false

  function open(): Promise<IDBDatabase> {
    if (connection) return Promise.resolve(connection)
    // 原生 open 请求无法取消。在被阻塞的请求结束前，不再叠加同样无法取消的请求。
    if (blockedOpen) return Promise.reject(blockedOpen.error)

    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB，无法保存或读取本机恢复副本。'))
        return
      }

      const request = indexedDB.open(databaseName, migrations.length)
      let abandoned = false
      let upgradeFailure: unknown

      function clearBlockedOpen() {
        if (blockedOpen?.request === request) blockedOpen = null
      }

      request.onblocked = () => {
        const error = new Error('本机恢复数据库升级被其他页面阻塞，请关闭使用它的页面后重试。')
        abandoned = true
        blockedOpen = { request, error }
        reject(error)
      }
      request.onupgradeneeded = event => {
        const transaction = request.transaction
        if (!transaction) {
          upgradeFailure = new Error('本机恢复数据库升级缺少事务。')
          return
        }
        // 调用方已经收到阻塞错误时，不在后台继续升级或持有连接。
        if (abandoned) {
          transaction.abort()
          return
        }
        try {
          for (const migrate of migrations.slice(event.oldVersion)) migrate(request.result, transaction)
        } catch (error) {
          upgradeFailure = error
          transaction.abort()
        }
      }
      request.onerror = () => {
        clearBlockedOpen()
        reject(upgradeFailure ?? request.error ?? new Error('无法打开本机恢复数据库。'))
      }
      request.onsuccess = () => {
        clearBlockedOpen()
        const database = request.result
        if (abandoned) {
          database.close()
          return
        }
        database.onversionchange = () => {
          // close 不取消正在提交的事务，但立即让出连接，避免阻塞其他页面升级。
          database.close()
          if (connection === database) connection = null
        }
        database.onclose = () => {
          if (connection === database) connection = null
        }
        connection = database
        resolve(database)
      }
    })
  }

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (closed) return Promise.reject(new Error('本机恢复存储已关闭，请创建新的存储实例。'))
    const result = databaseQueue.then(operation)
    // 每个失败仍返回给原调用方，但不能使其后的队列永久失败。
    databaseQueue = result.then(() => undefined, () => undefined)
    lastOperation = databaseQueue
    return result
  }

  return {
    list(postId) {
      return enqueue(async () => {
        const id = postId === undefined ? undefined : recoveryCopySchema.shape.postId.parse(postId)
        const database = await open()
        return transact<RecoveryCopy[]>(database, 'readonly', ({ store, request }, complete) => {
          const read: IDBRequest<unknown[]> = id === undefined
            ? store.getAll()
            : store.index(postIdIndex).getAll(id)
          request(read, values => {
            const copies = values.map(parseCopy)
            // schema 限定 UTC 且包含秒，移除统一的 Z 后按字典序比较，不丢失亚毫秒精度。
            copies.sort((left, right) => {
              const leftTime = left.updatedAt.slice(0, -1)
              const rightTime = right.updatedAt.slice(0, -1)
              return leftTime < rightTime ? 1 : leftTime > rightTime ? -1 : left.sessionId.localeCompare(right.sessionId)
            })
            complete(copies)
          })
        })
      })
    },
    put(copy) {
      // 在入队前解析并复制，调用方后续编辑不会改变已经排队的写入。
      let snapshot: RecoveryCopy
      try {
        snapshot = parseCopy(copy)
      } catch (error) {
        return Promise.reject(error)
      }
      return enqueue(async () => {
        const database = await open()
        return transact<void>(database, 'readwrite', ({ store, request }, complete) => {
          request<unknown>(store.get(snapshot.sessionId), previous => {
            if (previous !== undefined) parseCopy(previous)
            request(store.put(snapshot), () => complete(undefined))
          })
        })
      })
    },
    remove(sessionId) {
      return enqueue(async () => {
        const id = recoveryCopySchema.shape.sessionId.parse(sessionId)
        const database = await open()
        return transact<void>(database, 'readwrite', ({ store, request }, complete) => {
          request<unknown>(store.get(id), previous => {
            if (previous !== undefined) parseCopy(previous)
            request(store.delete(id), () => complete(undefined))
          })
        })
      })
    },
    close() {
      if (closed) return
      closed = true
      void lastOperation.then(() => {
        connection?.close()
        connection = null
      })
    },
  }
}
