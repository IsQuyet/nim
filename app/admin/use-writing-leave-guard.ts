'use client'

import { useEffect } from 'react'

const leaveMessage = 'This draft has changes that are not fully synced. Leave this page? Your completed local recovery copy will remain on this browser.'

export function useWritingLeaveGuard(shouldWarn: boolean) {
  useEffect(() => {
    if (!shouldWarn) return
    let approved: string | null = null
    let approvalTimer: ReturnType<typeof setTimeout> | undefined

    function beforeUnload(event: BeforeUnloadEvent) {
      if (approved) return
      event.preventDefault()
      event.returnValue = ''
    }

    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.download || target.hasAttribute('download')
        || (target.target && target.target !== '_self')) return
      const destination = new URL(target.href, location.href)
      const current = new URL(location.href)
      if (destination.origin !== current.origin) return
      if (destination.pathname === current.pathname && destination.search === current.search) return
      if (!window.confirm(leaveMessage)) {
        event.preventDefault()
        event.stopPropagation()
      } else {
        approved = destination.href
        clearTimeout(approvalTimer)
        approvalTimer = setTimeout(() => { approved = null }, 0)
      }
    }

    function navigate(event: Event) {
      if (!event.cancelable || !('canIntercept' in event) || event.canIntercept !== true
        || !('navigationType' in event) || event.navigationType !== 'traverse') return
      const destination = 'destination' in event ? event.destination : null
      if (!destination || typeof destination !== 'object' || !('url' in destination) || typeof destination.url !== 'string') return
      const next = new URL(destination.url, location.href)
      const current = new URL(location.href)
      if (next.pathname === current.pathname && next.search === current.search) return
      if (approved === next.href) return
      if (!window.confirm(leaveMessage)) event.preventDefault()
    }

    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    // Navigation API 可取消同文档的前进/后退，不往历史栈额外插入占位条目。
    const navigation = 'navigation' in window ? window.navigation : null
    if (navigation instanceof EventTarget) navigation.addEventListener('navigate', navigate)
    return () => {
      clearTimeout(approvalTimer)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      if (navigation instanceof EventTarget) navigation.removeEventListener('navigate', navigate)
    }
  }, [shouldWarn])
}
