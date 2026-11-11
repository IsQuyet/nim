import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  AnimatedBackground,
  type AnimatedBackgroundProps,
} from './animated-background'

function Background(props: Omit<AnimatedBackgroundProps, 'children'>) {
  return (
    <AnimatedBackground {...props}>
      <button data-id="a">A</button>
      <button data-id="b">B</button>
      <button data-id="c">C</button>
    </AnimatedBackground>
  )
}

const selected = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('data-checked')

describe('背景选中状态', () => {
  it('默认值只用于初始化，不覆盖之后的内部选择', () => {
    const { rerender } = render(<Background defaultValue="a" />)
    expect(selected('A')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    rerender(<Background defaultValue="c" />)
    expect(selected('B')).toBe('true')
    expect(selected('C')).toBe('false')
  })

  it('受控时以父组件的值为准，点击只请求改变选择', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <Background value="a" onValueChange={onValueChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(onValueChange).toHaveBeenLastCalledWith('b')
    expect(selected('A')).toBe('true')
    rerender(<Background value="b" onValueChange={onValueChange} />)
    expect(selected('B')).toBe('true')
  })

  it('受控的 null 表示不选中，不回退到默认值', () => {
    const { rerender } = render(<Background value="a" defaultValue="b" />)
    rerender(<Background value={null} defaultValue="b" />)
    expect(selected('A')).toBe('false')
    expect(selected('B')).toBe('false')
    expect(selected('C')).toBe('false')
  })

  it('非受控悬停在离开条目时清空选择', () => {
    render(<Background enableHover />)
    const item = screen.getByRole('button', { name: 'A' })
    fireEvent.mouseEnter(item)
    expect(selected('A')).toBe('true')
    fireEvent.mouseLeave(item)
    expect(selected('A')).toBe('false')
  })

  it('受控悬停只通知父组件，由父组件决定何时清空', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <Background value="a" enableHover onValueChange={onValueChange} />,
    )
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'A' }))
    expect(onValueChange).toHaveBeenLastCalledWith(null)
    expect(selected('A')).toBe('true')
    rerender(
      <Background value={null} enableHover onValueChange={onValueChange} />,
    )
    expect(selected('A')).toBe('false')
  })
})
