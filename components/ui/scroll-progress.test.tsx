import { render, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollProgress } from './scroll-progress'

function ScrollContainer() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} data-testid="scroll-container" style={{ overflow: 'auto' }}>
      <ScrollProgress containerRef={ref} />
      <div style={{ height: 2000 }}>正文</div>
    </div>
  )
}

describe('滚动订阅时机', () => {
  it('等待祖先 DOM ref 就绪后监听容器，而不是回退到整页', async () => {
    const addListener = vi.spyOn(EventTarget.prototype, 'addEventListener')
    const removeListener = vi.spyOn(EventTarget.prototype, 'removeEventListener')
    const warning = vi.spyOn(console, 'warn')
    const { getByTestId, unmount } = render(<ScrollContainer />)
    const container = getByTestId('scroll-container')

    await waitFor(() => {
      expect(addListener.mock.calls.some(
        (args, index) => args[0] === 'scroll' && addListener.mock.contexts[index] === container,
      )).toBe(true)
    })
    expect(warning.mock.calls.some(args => String(args[0]).includes('not yet hydrated'))).toBe(false)

    unmount()
    expect(removeListener.mock.calls.some(
      (args, index) => args[0] === 'scroll' && removeListener.mock.contexts[index] === container,
    )).toBe(true)
  })

  it('未指定容器时监听整页滚动', async () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ScrollProgress />)
    await waitFor(() => {
      expect(addListener.mock.calls.some(args => args[0] === 'scroll')).toBe(true)
    })
    unmount()
    expect(removeListener.mock.calls.some(args => args[0] === 'scroll')).toBe(true)
  })
})
