import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettled } from './useSettled'

const seen: string[] = []

function Probe({ value }: { value: string }) {
  const settled = useSettled(value, 200)
  seen.push(settled)
  return <span>{settled}</span>
}

beforeEach(() => {
  seen.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('等待变化停顿', () => {
  it('挂载时直接采用当时的值', () => {
    const { container } = render(<Probe value="first" />)
    expect(container.textContent).toBe('first')
  })

  it('连续变化期间保持上一个结果，停顿后只采用最后的值', () => {
    const { container, rerender } = render(<Probe value="first" />)
    for (const value of ['second', 'third', 'fourth']) {
      rerender(<Probe value={value} />)
      act(() => { vi.advanceTimersByTime(150) })
      expect(container.textContent).toBe('first')
    }
    act(() => { vi.advanceTimersByTime(200) })
    expect(container.textContent).toBe('fourth')
    expect(seen).not.toContain('second')
    expect(seen).not.toContain('third')
  })

  it('变回已采用的值时取消等待中的更新', () => {
    const { container, rerender } = render(<Probe value="first" />)
    rerender(<Probe value="second" />)
    rerender(<Probe value="first" />)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.textContent).toBe('first')
    expect(seen).not.toContain('second')
  })

  it('卸载时不留下等待中的更新', () => {
    const { rerender, unmount } = render(<Probe value="first" />)
    rerender(<Probe value="second" />)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
