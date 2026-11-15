'use client'

import { useContext, useState, useSyncExternalStore } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { createRecoveryStore } from '@/lib/recovery-store'
import { WritingSession } from '@/lib/writing-session'
import type { WorkingCopy, WritingTransport } from '@/lib/writing'
import { WritingSessionsContext, type WritingBridgeSnapshot, type WritingSessionBridge } from './writing-sessions'

type Options = { postId: string; isNew: boolean; initial: WorkingCopy | null; transport: WritingTransport }

function sessionBridge(options: Options, activate: () => void, release: () => void): WritingSessionBridge {
  const listeners = new Set<() => void>()
  let failure: WritingBridgeSnapshot['failure'] = null
  const reportError = (error: unknown) => {
    failure = { error }
    for (const listener of listeners) listener()
  }
  const session = new WritingSession({
    ...options,
    recovery: createRecoveryStore(),
    handleControlFlow(error) {
      try {
        unstable_rethrow(error)
        return false
      } catch (signal) {
        reportError(signal)
        return true
      }
    },
  })
  const initial: WritingBridgeSnapshot = { writing: session.getSnapshot(), failure: null }
  let snapshot = initial
  let generation = 0

  return {
    session,
    getSnapshot() {
      const writing = session.getSnapshot()
      if (writing !== snapshot.writing || failure !== snapshot.failure) snapshot = { writing, failure }
      return snapshot
    },
    getServerSnapshot: () => initial,
    subscribe(listener) {
      activate()
      listeners.add(listener)
      generation++
      const unsubscribe = session.subscribe(listener)
      void session.start().catch(reportError)
      return () => {
        unsubscribe()
        listeners.delete(listener)
        const closing = ++generation
        // RSC 替换页面或 Strict Mode 同轮重订阅时沿用会话，真正离开才释放。
        queueMicrotask(() => {
          if (listeners.size === 0 && generation === closing) {
            session.dispose()
            release()
          }
        })
      }
    },
  }
}

export function useWritingSession(options: Options) {
  const registry = useContext(WritingSessionsContext)
  if (!registry) throw new Error('编辑器缺少写作会话边界。')
  const [bridge] = useState(() => registry.acquire(options.postId, (activate, release) => sessionBridge(options, activate, release)))
  const snapshot = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getServerSnapshot)
  if (snapshot.failure) throw snapshot.failure.error
  return { session: bridge.session, snapshot: snapshot.writing }
}
