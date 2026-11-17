import { useEffect, useState } from 'react'

/** 返回在 delayMs 内没有再变化的值。挂载时直接采用当时的值，连续变化期间保持上一个结果。 */
export function useSettled<Value>(value: Value, delayMs: number) {
  const [settled, setSettled] = useState(() => value)

  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(() => value), delayMs)
    return () => clearTimeout(timer)
  }, [value, settled, delayMs])

  return settled
}
