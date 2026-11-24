import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// jsdom 不做版面计算，也没有实现滚动。界面里把元素带进视口的调用在这里不做任何事。
// 在 node 环境运行的测试没有 DOM。
if (typeof Element !== 'undefined') Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
