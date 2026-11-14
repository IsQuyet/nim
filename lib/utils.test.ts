import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('Tailwind 类名组合', () => {
  it('保留可以并存的渐变背景和背景颜色', () => {
    expect(cn('bg-linear-to-r from-cyan-500 to-blue-500', 'bg-red-500'))
      .toBe('bg-linear-to-r from-cyan-500 to-blue-500 bg-red-500')
  })

  it('由后面的 CSS 变量尺寸覆盖固定尺寸', () => {
    expect(cn('h-10', 'h-(--editor-height)')).toBe('h-(--editor-height)')
  })

  it('合并条件类名，同时保留不同变体下的独立样式', () => {
    expect(cn('border-zinc-200 p-2 dark:border-zinc-800', false, { 'p-4': true }))
      .toBe('border-zinc-200 dark:border-zinc-800 p-4')
  })
})
