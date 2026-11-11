import { act, render, screen } from '@testing-library/react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useIsClient } from './useIsClient'

function Probe() {
  return <span>{useIsClient() ? 'client' : 'server'}</span>
}

describe('客户端水合边界', () => {
  it('服务端不渲染依赖浏览器的内容', () => {
    expect(renderToString(<Probe />)).toContain('server')
  })

  it('纯客户端挂载可直接渲染客户端内容', () => {
    render(<Probe />)
    expect(screen.getByText('client')).toBeDefined()
  })

  it('服务端快照与水合首帧一致，之后切换到客户端内容', async () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Probe />)
    document.body.append(container)
    const errors: unknown[] = []
    let root: Root | undefined
    try {
      await act(async () => {
        root = hydrateRoot(container, <Probe />, {
          onRecoverableError: error => errors.push(error),
        })
      })
      expect(container.textContent).toBe('client')
      expect(errors).toEqual([])
    } finally {
      await act(async () => root?.unmount())
      container.remove()
    }
  })
})
