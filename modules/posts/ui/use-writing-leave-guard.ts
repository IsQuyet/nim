'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type PendingNavigation =
  | { kind: 'link'; href: string }
  | { kind: 'traverse'; key: string; url: string; resolve: (approved: boolean) => void }

type NavigationApiHandle = {
  target: EventTarget
}

function getNavigationTarget(event: Event) {
  if (!event.cancelable || !('canIntercept' in event) || event.canIntercept !== true
    || !('navigationType' in event) || event.navigationType !== 'traverse') return null

  const destination = Reflect.get(event, 'destination')
  if (typeof destination !== 'object' || destination === null) return null
  const key = Reflect.get(destination, 'key')
  const url = Reflect.get(destination, 'url')
  const intercept = Reflect.get(event, 'intercept')
  return typeof key === 'string' && typeof url === 'string' && typeof intercept === 'function'
    ? { key, url, intercept }
    : null
}

const leaveDescription = 'Your changes have not been submitted to the server. A local recovery copy will remain on this browser if it has finished saving.'

export function useWritingLeaveGuard(shouldWarn: boolean, navigate: (href: string) => void) {
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const pendingRef = useRef<PendingNavigation | null>(null)
  const shouldWarnRef = useRef(shouldWarn)

  useEffect(() => {
    shouldWarnRef.current = shouldWarn
  }, [shouldWarn])

  const cancelNavigation = useCallback(() => {
    const pending = pendingRef.current
    pendingRef.current = null
    setPendingNavigation(null)
    if (pending?.kind === 'traverse') pending.resolve(false)
  }, [])

  const confirmNavigation = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return

    pendingRef.current = null
    setPendingNavigation(null)
    if (pending.kind === 'link') {
      navigate(pending.href)
    } else {
      pending.resolve(true)
    }
  }, [navigate])

  useEffect(() => {
    function requestNavigation(pending: PendingNavigation) {
      if (pendingRef.current) return false
      pendingRef.current = pending
      setPendingNavigation(pending)
      return true
    }

    function beforeUnload(event: BeforeUnloadEvent) {
      if (!shouldWarnRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }

    function click(event: MouseEvent) {
      if (!shouldWarnRef.current || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.download || target.hasAttribute('download')
        || (target.target && target.target !== '_self')) return

      const destination = new URL(target.href, location.href)
      const current = new URL(location.href)
      if (destination.origin !== current.origin) return
      if (destination.pathname === current.pathname && destination.search === current.search) return

      event.preventDefault()
      event.stopPropagation()
      requestNavigation({ kind: 'link', href: destination.href })
    }

    const navigation: NavigationApiHandle | null = 'navigation' in window
      && window.navigation instanceof EventTarget
      ? { target: window.navigation }
      : null

    function navigateEvent(event: Event) {
      if (!shouldWarnRef.current) return
      const target = getNavigationTarget(event)
      if (!target) return

      const destination = new URL(target.url, location.href)
      const current = new URL(location.href)
      if (destination.origin !== current.origin) return
      if (destination.pathname === current.pathname && destination.search === current.search) return

      let resolveDecision: (approved: boolean) => void = () => {}
      const decision = new Promise<boolean>(resolve => { resolveDecision = resolve })
      const precommitHandler = async () => {
        if (!(await decision)) throw new DOMException('Navigation cancelled.', 'AbortError')
      }
      Reflect.apply(target.intercept, event, [{ precommitHandler }])

      const accepted = requestNavigation({
        kind: 'traverse',
        key: target.key,
        url: destination.href,
        resolve: resolveDecision,
      })
      if (!accepted) resolveDecision(false)
    }

    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    navigation?.target.addEventListener('navigate', navigateEvent)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      navigation?.target.removeEventListener('navigate', navigateEvent)
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending?.kind === 'traverse') pending.resolve(false)
    }
  }, [navigate])

  return { pendingNavigation, cancelNavigation, confirmNavigation, leaveDescription }
}
