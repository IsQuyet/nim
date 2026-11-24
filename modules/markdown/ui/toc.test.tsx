import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarkdownHeading } from '../headings'
import { TableOfContents } from './toc'

const headings: MarkdownHeading[] = [
  { id: 'intro', text: 'Introduction', depth: 2 },
  { id: 'details', text: 'Implementation details', depth: 3 },
  { id: 'summary', text: 'Summary', depth: 2 },
]

describe('TableOfContents', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    for (const heading of headings) {
      const el = document.createElement(heading.depth === 2 ? 'h2' : 'h3')
      el.id = heading.id
      el.textContent = heading.text
      document.body.appendChild(el)
    }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('无标题时不渲染目录', () => {
    const { container } = render(<TableOfContents headings={[]} variant="sidebar" />)
    expect(container.firstChild).toBeNull()
  })

  it('宽屏侧栏渲染所有章节链接并随滚动高亮当前章节', () => {
    const tops: Record<string, number> = { intro: 140, details: 360, summary: 720 }
    for (const heading of headings) {
      vi.spyOn(document.getElementById(heading.id)!, 'getBoundingClientRect').mockImplementation(() => ({
        top: tops[heading.id],
        bottom: tops[heading.id] + 24,
        left: 0,
        right: 100,
        width: 100,
        height: 24,
        x: 0,
        y: tops[heading.id],
        toJSON: () => ({}),
      }))
    }

    render(<TableOfContents headings={headings} variant="sidebar" />)
    const nav = screen.getByRole('navigation', { name: 'On this page' })
    const links = within(nav).getAllByRole('link')
    expect(links.map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Introduction', '#intro'],
      ['Implementation details', '#details'],
      ['Summary', '#summary'],
    ])
    expect(links[0].getAttribute('aria-current')).toBe('location')

    act(() => {
      tops.intro = -120
      tops.details = 40
      tops.summary = 420
      fireEvent.scroll(window)
    })

    expect(links[0].getAttribute('aria-current')).toBeNull()
    expect(links[1].getAttribute('aria-current')).toBe('location')
  })

  it('窄屏折叠目录默认收起，展开并选中章节后自动收起', () => {
    render(<TableOfContents headings={headings} variant="inline" />)
    const details = document.querySelector('details')!
    expect(details.open).toBe(false)

    fireEvent.click(screen.getByText('On this page'))
    expect(details.open).toBe(true)

    const summaryLink = screen.getByRole('link', { name: 'Summary' })
    fireEvent.click(summaryLink)
    expect(details.open).toBe(false)
    expect(summaryLink.getAttribute('aria-current')).toBe('location')
  })
})
