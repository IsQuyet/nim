'use client'

import { createContext, useState, type ReactNode } from 'react'
import type { WritingSession, WritingSessionSnapshot } from '../writing-session'

export type WritingBridgeSnapshot = {
  writing: WritingSessionSnapshot
  failure: { error: unknown } | null
}

export type WritingSessionBridge = {
  session: WritingSession
  getSnapshot: () => WritingBridgeSnapshot
  getServerSnapshot: () => WritingBridgeSnapshot
  subscribe: WritingSession['subscribe']
}

type Registry = {
  acquire(postId: string, create: (activate: () => void, release: () => void) => WritingSessionBridge): WritingSessionBridge
}

export const WritingSessionsContext = createContext<Registry | null>(null)

function createRegistry(): Registry {
  const bridges = new Set<WritingSessionBridge>()
  return {
    acquire(postId, create) {
      for (const bridge of bridges) {
        const snapshot = bridge.session.getSnapshot()
        if (snapshot.postId === postId && snapshot.serverStatus !== 'disposed') return bridge
      }
      const bridge = create(() => { bridges.add(bridge) }, () => { bridges.delete(bridge) })
      return bridge
    },
  }
}

export function WritingSessionsProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createRegistry)
  return <WritingSessionsContext.Provider value={registry}>{children}</WritingSessionsContext.Provider>
}
